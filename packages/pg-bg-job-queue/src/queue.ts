import { Pool } from 'pg';
import { JobOptions, JobRecord, FailureReason } from './types.js';
import { log } from './log-context.js';

/**
 * Add a job to the queue
 */
export const addJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  {
    job_type,
    payload,
    max_attempts = 3,
    priority = 0,
    run_at = null,
    timeoutMs = undefined,
  }: JobOptions<PayloadMap, T>,
): Promise<number> => {
  const client = await pool.connect();
  try {
    let result;
    if (run_at) {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, run_at, timeout_ms) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING id`,
        [job_type, payload, max_attempts, priority, run_at, timeoutMs ?? null],
      );
      log(
        `Added job ${result.rows[0].id}: payload ${JSON.stringify(payload)}, run_at ${run_at.toISOString()}, priority ${priority}, max_attempts ${max_attempts} job_type ${job_type}`,
      );
    } else {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, timeout_ms) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [job_type, payload, max_attempts, priority, timeoutMs ?? null],
      );
      log(
        `Added job ${result.rows[0].id}: payload ${JSON.stringify(payload)}, priority ${priority}, max_attempts ${max_attempts} job_type ${job_type}`,
      );
    }
    return result.rows[0].id;
  } catch (error) {
    log(`Error adding job: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get a job by ID
 */
export const getJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  id: number,
): Promise<JobRecord<PayloadMap, T> | null> => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM job_queue WHERE id = $1', [
      id,
    ]);

    if (result.rows.length === 0) {
      log(`Job ${id} not found`);
      return null;
    }

    log(`Found job ${id}`);

    return {
      ...result.rows[0],
      payload: result.rows[0].payload,
      timeout_ms: result.rows[0].timeout_ms,
      failure_reason: result.rows[0].failure_reason,
    };
  } catch (error) {
    log(`Error getting job ${id}: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get jobs by status
 */
export const getJobsByStatus = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  status: string,
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset],
    );

    log(`Found ${result.rows.length} jobs by status ${status}`);

    return result.rows.map((row) => ({
      ...row,
      payload: row.payload,
      timeout_ms: row.timeout_ms,
      failure_reason: row.failure_reason,
    }));
  } catch (error) {
    log(`Error getting jobs by status ${status}: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get the next batch of jobs to process
 * @param pool - The database pool
 * @param workerId - The worker ID
 * @param batchSize - The batch size
 * @param jobType - Only fetch jobs with this job type (string or array of strings)
 */
export const getNextBatch = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  workerId: string,
  batchSize = 10,
  jobType?: string | string[],
): Promise<JobRecord<PayloadMap, T>[]> => {
  const client = await pool.connect();
  try {
    // Begin transaction
    await client.query('BEGIN');

    // Build job type filter
    let jobTypeFilter = '';
    let params: any[] = [workerId, batchSize];
    if (jobType) {
      if (Array.isArray(jobType)) {
        jobTypeFilter = ` AND job_type = ANY($3)`;
        params.push(jobType);
      } else {
        jobTypeFilter = ` AND job_type = $3`;
        params.push(jobType);
      }
    }

    // Get and lock a batch of jobs
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'processing', 
          locked_at = NOW(), 
          locked_by = $1,
          attempts = attempts + 1,
          updated_at = NOW(),
          pending_reason = NULL
      WHERE id IN (
        SELECT id FROM job_queue
        WHERE (status = 'pending' OR (status = 'failed' AND next_attempt_at <= NOW()))
        AND (attempts < max_attempts)
        AND run_at <= NOW()
        ${jobTypeFilter}
        ORDER BY priority DESC, created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `,
      params,
    );

    log(`Found ${result.rows.length} jobs to process`);

    // Commit transaction
    await client.query('COMMIT');

    return result.rows.map((row) => ({
      ...row,
      payload: row.payload,
      timeout_ms: row.timeout_ms,
    }));
  } catch (error) {
    log(`Error getting next batch: ${error}`);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Mark a job as completed
 */
export const completeJob = async (pool: Pool, jobId: number): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1
    `,
      [jobId],
    );
  } catch (error) {
    log(`Error completing job ${jobId}: ${error}`);
    throw error;
  } finally {
    log(`Completed job ${jobId}`);
    client.release();
  }
};

/**
 * Mark a job as failed
 */
export const failJob = async (
  pool: Pool,
  jobId: number,
  error: Error,
  failureReason?: FailureReason,
): Promise<void> => {
  const client = await pool.connect();
  try {
    /**
     * The next attempt will be scheduled after `2^attempts * 1 minute` from the last attempt.
     */
    await client.query(
      `
      UPDATE job_queue
      SET status = 'failed', 
          updated_at = NOW(),
          next_attempt_at = CASE 
            WHEN attempts < max_attempts THEN NOW() + (POWER(2, attempts) * INTERVAL '1 minute')
            ELSE NULL
          END,
          error_history = COALESCE(error_history, '[]'::jsonb) || $2::jsonb,
          failure_reason = $3
      WHERE id = $1
    `,
      [
        jobId,
        JSON.stringify([
          {
            message: error.message || String(error),
            timestamp: new Date().toISOString(),
          },
        ]),
        failureReason ?? null,
      ],
    );
  } catch (error) {
    log(`Error failing job ${jobId}: ${error}`);
    throw error;
  } finally {
    log(`Failed job ${jobId}`);
    client.release();
  }
};

/**
 * Retry a failed job immediately
 */
export const retryJob = async (pool: Pool, jobId: number): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET status = 'pending', 
          updated_at = NOW(),
          locked_at = NULL,
          locked_by = NULL,
          next_attempt_at = NOW()
      WHERE id = $1
    `,
      [jobId],
    );
  } catch (error) {
    log(`Error retrying job ${jobId}: ${error}`);
    throw error;
  } finally {
    log(`Retried job ${jobId}`);
    client.release();
  }
};

/**
 * Delete old completed jobs
 */
export const cleanupOldJobs = async (
  pool: Pool,
  daysToKeep = 30,
): Promise<number> => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      DELETE FROM job_queue
      WHERE status = 'completed'
      AND updated_at < NOW() - INTERVAL '${daysToKeep} days'
      RETURNING id
    `);
    log(`Deleted ${result.rowCount} old jobs`);
    return result.rowCount || 0;
  } catch (error) {
    log(`Error cleaning up old jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel a scheduled job (only if still pending)
 */
export const cancelJob = async (pool: Pool, jobId: number): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
    `,
      [jobId],
    );
  } catch (error) {
    log(`Error cancelling job ${jobId}: ${error}`);
    throw error;
  } finally {
    log(`Cancelled job ${jobId}`);
    client.release();
  }
};

/**
 * Cancel all upcoming jobs (pending and scheduled in the future) with optional filters
 */
export const cancelAllUpcomingJobs = async (
  pool: Pool,
  filters?: { job_type?: string; priority?: number; run_at?: Date },
): Promise<number> => {
  const client = await pool.connect();
  try {
    let query = `
      UPDATE job_queue
      SET status = 'cancelled', updated_at = NOW()
      WHERE status = 'pending'`;
    const params: any[] = [];
    let paramIdx = 1;
    if (filters) {
      if (filters.job_type) {
        query += ` AND job_type = $${paramIdx++}`;
        params.push(filters.job_type);
      }
      if (filters.priority !== undefined) {
        query += ` AND priority = $${paramIdx++}`;
        params.push(filters.priority);
      }
      if (filters.run_at) {
        query += ` AND run_at = $${paramIdx++}`;
        params.push(filters.run_at);
      }
    }
    query += '\nRETURNING id';
    const result = await client.query(query, params);
    log(`Cancelled ${result.rowCount} jobs`);
    return result.rowCount || 0;
  } catch (error) {
    log(`Error cancelling upcoming jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get all jobs with optional pagination
 */
export const getAllJobs = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM job_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    log(`Found ${result.rows.length} jobs (all)`);
    return result.rows.map((row) => ({
      ...row,
      payload: row.payload,
      timeout_ms: row.timeout_ms,
    }));
  } catch (error) {
    log(`Error getting all jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Set a pending reason for unpicked jobs
 */
export const setPendingReasonForUnpickedJobs = async (
  pool: Pool,
  reason: string,
  jobType?: string | string[],
) => {
  const client = await pool.connect();
  try {
    let jobTypeFilter = '';
    let params: any[] = [reason];
    if (jobType) {
      if (Array.isArray(jobType)) {
        jobTypeFilter = ` AND job_type = ANY($2)`;
        params.push(jobType);
      } else {
        jobTypeFilter = ` AND job_type = $2`;
        params.push(jobType);
      }
    }
    await client.query(
      `UPDATE job_queue SET pending_reason = $1 WHERE status = 'pending'${jobTypeFilter}`,
      params,
    );
  } finally {
    client.release();
  }
};

/**
 * Reclaim jobs stuck in 'processing' for too long.
 *
 * If a process (e.g., API route or worker) crashes after marking a job as 'processing' but before completing it, the job can remain stuck in the 'processing' state indefinitely. This can happen if the process is killed or encounters an unhandled error after updating the job status but before marking it as 'completed' or 'failed'.
 * @param pool - The database pool
 * @param maxProcessingTimeMinutes - Max allowed processing time in minutes (default: 10)
 * @returns Number of jobs reclaimed
 */
export const reclaimStuckJobs = async (
  pool: Pool,
  maxProcessingTimeMinutes = 10,
): Promise<number> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = NOW()
      WHERE status = 'processing'
        AND locked_at < NOW() - INTERVAL '${maxProcessingTimeMinutes} minutes'
      RETURNING id
      `,
    );
    log(`Reclaimed ${result.rowCount} stuck jobs`);
    return result.rowCount || 0;
  } catch (error) {
    log(`Error reclaiming stuck jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};
