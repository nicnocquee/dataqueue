import { Pool } from 'pg';
import {
  JobOptions,
  JobRecord,
  FailureReason,
  JobEvent,
  JobEventType,
  TagQueryMode,
} from './types.js';
import { log } from './log-context.js';

/**
 * Record a job event in the job_events table
 */
export const recordJobEvent = async (
  pool: Pool,
  jobId: number,
  eventType: JobEventType,
  metadata?: any,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO job_events (job_id, event_type, metadata) VALUES ($1, $2, $3)`,
      [jobId, eventType, metadata ? JSON.stringify(metadata) : null],
    );
  } catch (error) {
    log(`Error recording job event for job ${jobId}: ${error}`);
    // Do not throw, to avoid interfering with main job logic
  } finally {
    client.release();
  }
};

/**
 * Add a job to the queue
 */
export const addJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  {
    jobType,
    payload,
    maxAttempts = 3,
    priority = 0,
    runAt = null,
    timeoutMs = undefined,
    tags = undefined,
  }: JobOptions<PayloadMap, T>,
): Promise<number> => {
  const client = await pool.connect();
  try {
    let result;
    if (runAt) {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, run_at, timeout_ms, tags) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id`,
        [
          jobType,
          payload,
          maxAttempts,
          priority,
          runAt,
          timeoutMs ?? null,
          tags ?? null,
        ],
      );
      log(
        `Added job ${result.rows[0].id}: payload ${JSON.stringify(payload)}, runAt ${runAt.toISOString()}, priority ${priority}, maxAttempts ${maxAttempts} jobType ${jobType}, tags ${JSON.stringify(tags)}`,
      );
    } else {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, timeout_ms, tags) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING id`,
        [
          jobType,
          payload,
          maxAttempts,
          priority,
          timeoutMs ?? null,
          tags ?? null,
        ],
      );
      log(
        `Added job ${result.rows[0].id}: payload ${JSON.stringify(payload)}, priority ${priority}, maxAttempts ${maxAttempts} jobType ${jobType}, tags ${JSON.stringify(tags)}`,
      );
    }
    await recordJobEvent(pool, result.rows[0].id, JobEventType.Added, {
      jobType,
      payload,
      tags,
    });
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
    const result = await client.query(
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason" FROM job_queue WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      log(`Job ${id} not found`);
      return null;
    }

    log(`Found job ${id}`);

    const job = result.rows[0] as JobRecord<PayloadMap, T>;

    return {
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      failureReason: job.failureReason,
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
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason" FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );

    log(`Found ${result.rows.length} jobs by status ${status}`);

    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      failureReason: job.failureReason,
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
          pending_reason = NULL,
          started_at = COALESCE(started_at, NOW()),
          last_retried_at = CASE WHEN attempts > 0 THEN NOW() ELSE last_retried_at END
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
      RETURNING id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason"
    `,
      params,
    );

    log(`Found ${result.rows.length} jobs to process`);

    // Commit transaction
    await client.query('COMMIT');

    // Record processing event for each job
    for (const row of result.rows) {
      await recordJobEvent(pool, row.id, JobEventType.Processing);
    }

    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
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
      SET status = 'completed', updated_at = NOW(), completed_at = NOW()
      WHERE id = $1
    `,
      [jobId],
    );
    await recordJobEvent(pool, jobId, JobEventType.Completed);
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
          failure_reason = $3,
          last_failed_at = NOW()
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
    await recordJobEvent(pool, jobId, JobEventType.Failed, {
      message: error.message || String(error),
      failureReason,
    });
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
          next_attempt_at = NOW(),
          last_retried_at = NOW()
      WHERE id = $1
    `,
      [jobId],
    );
    await recordJobEvent(pool, jobId, JobEventType.Retried);
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
      SET status = 'cancelled', updated_at = NOW(), last_cancelled_at = NOW()
      WHERE id = $1 AND status = 'pending'
    `,
      [jobId],
    );
    await recordJobEvent(pool, jobId, JobEventType.Cancelled);
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
  filters?: { jobType?: string; priority?: number; runAt?: Date },
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
      if (filters.jobType) {
        query += ` AND job_type = $${paramIdx++}`;
        params.push(filters.jobType);
      }
      if (filters.priority !== undefined) {
        query += ` AND priority = $${paramIdx++}`;
        params.push(filters.priority);
      }
      if (filters.runAt) {
        query += ` AND run_at = $${paramIdx++}`;
        params.push(filters.runAt);
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
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason" FROM job_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    log(`Found ${result.rows.length} jobs (all)`);
    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
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

/**
 * Get all events for a job, ordered by createdAt ascending
 */
export const getJobEvents = async (
  pool: Pool,
  jobId: number,
): Promise<JobEvent[]> => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, job_id AS "jobId", event_type AS "eventType", metadata, created_at AS "createdAt" FROM job_events WHERE job_id = $1 ORDER BY created_at ASC`,
      [jobId],
    );
    return res.rows as JobEvent[];
  } finally {
    client.release();
  }
};

/**
 * Get jobs by tags (matches all specified tags)
 */
export const getJobsByTags = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  tags: string[],
  mode: TagQueryMode = 'all',
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> => {
  const client = await pool.connect();
  try {
    let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags
       FROM job_queue`;
    let params: any[] = [];
    switch (mode) {
      case 'exact':
        query += ' WHERE tags = $1';
        params = [tags];
        break;
      case 'all':
        query += ' WHERE tags @> $1';
        params = [tags];
        break;
      case 'any':
        query += ' WHERE tags && $1';
        params = [tags];
        break;
      case 'none':
        query += ' WHERE NOT (tags && $1)';
        params = [tags];
        break;
      default:
        query += ' WHERE tags @> $1';
        params = [tags];
    }
    query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);
    const result = await client.query(query, params);
    log(
      `Found ${result.rows.length} jobs by tags ${JSON.stringify(tags)} (mode: ${mode})`,
    );
    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      failureReason: job.failureReason,
    }));
  } catch (error) {
    log(
      `Error getting jobs by tags ${JSON.stringify(tags)} (mode: ${mode}): ${error}`,
    );
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel jobs by tags (matches all specified tags)
 */
export const cancelJobsByTags = async (
  pool: Pool,
  tags: string[],
  mode: TagQueryMode = 'all',
): Promise<number> => {
  const client = await pool.connect();
  try {
    let query = `UPDATE job_queue
       SET status = 'cancelled', updated_at = NOW(), last_cancelled_at = NOW()
       WHERE status = 'pending'`;
    switch (mode) {
      case 'exact':
        query += ' AND tags = $1';
        break;
      case 'all':
        query += ' AND tags @> $1';
        break;
      case 'any':
        query += ' AND tags && $1';
        break;
      case 'none':
        query += ' AND NOT (tags && $1)';
        break;
      default:
        query += ' AND tags @> $1';
    }
    query += ' RETURNING id';
    const result = await client.query(query, [tags]);
    log(
      `Cancelled ${result.rowCount} jobs by tags ${JSON.stringify(tags)} (mode: ${mode})`,
    );
    return result.rowCount || 0;
  } catch (error) {
    log(
      `Error cancelling jobs by tags ${JSON.stringify(tags)} (mode: ${mode}): ${error}`,
    );
    throw error;
  } finally {
    client.release();
  }
};
