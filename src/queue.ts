import { Pool } from 'pg';
import { JobOptions, JobRecord } from './types.js';

/**
 * Add a job to the queue
 */
export const addJob = async (
  pool: Pool,
  {
    job_type,
    payload,
    max_attempts = 3,
    priority = 0,
    run_at = null,
  }: JobOptions,
): Promise<number> => {
  const client = await pool.connect();
  try {
    let result;
    if (run_at) {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, run_at) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [job_type, payload, max_attempts, priority, run_at],
      );
    } else {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [job_type, payload, max_attempts, priority],
      );
    }
    return result.rows[0].id;
  } finally {
    client.release();
  }
};

/**
 * Get a job by ID
 */
export const getJob = async (
  pool: Pool,
  id: number,
): Promise<JobRecord | null> => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM job_queue WHERE id = $1', [
      id,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      ...result.rows[0],
      payload: result.rows[0].payload,
    };
  } finally {
    client.release();
  }
};

/**
 * Get jobs by status
 */
export const getJobsByStatus = async (
  pool: Pool,
  status: string,
  limit = 100,
  offset = 0,
): Promise<JobRecord[]> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset],
    );

    return result.rows.map((row) => ({
      ...row,
      payload: row.payload,
    }));
  } finally {
    client.release();
  }
};

/**
 * Get the next batch of jobs to process
 */
export const getNextBatch = async (
  pool: Pool,
  workerId: string,
  batchSize = 10,
): Promise<JobRecord[]> => {
  const client = await pool.connect();
  try {
    // Begin transaction
    await client.query('BEGIN');

    // Get and lock a batch of jobs
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'processing', 
          locked_at = NOW(), 
          locked_by = $1,
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM job_queue
        WHERE (status = 'pending' OR (status = 'failed' AND next_attempt_at <= NOW()))
        AND (attempts < max_attempts)
        AND run_at <= NOW()
        ORDER BY priority DESC, created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `,
      [workerId, batchSize],
    );

    // Commit transaction
    await client.query('COMMIT');

    return result.rows.map((row) => ({
      ...row,
      payload: row.payload,
    }));
  } catch (error) {
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
  } finally {
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
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET status = 'failed', 
          updated_at = NOW(),
          next_attempt_at = CASE 
            WHEN attempts < max_attempts THEN NOW() + (POWER(2, attempts) * INTERVAL '1 minute')
            ELSE NULL
          END,
          payload = jsonb_set(payload, '{last_error}', $2)
      WHERE id = $1
    `,
      [jobId, JSON.stringify(error.message || String(error))],
    );
  } finally {
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
  } finally {
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
    return result.rowCount || 0;
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
  } finally {
    client.release();
  }
};

/**
 * Cancel all upcoming jobs (pending and scheduled in the future)
 */
export const cancelAllUpcomingJobs = async (pool: Pool): Promise<number> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'cancelled', updated_at = NOW()
      WHERE status = 'pending'
      RETURNING id
    `,
    );
    return result.rowCount || 0;
  } finally {
    client.release();
  }
};
