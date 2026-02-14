import { Pool } from 'pg';
import {
  JobOptions,
  JobRecord,
  FailureReason,
  JobEvent,
  JobEventType,
  TagQueryMode,
  WaitpointRecord,
} from './types.js';
import { randomUUID } from 'crypto';
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
    forceKillOnTimeout = false,
    tags = undefined,
    idempotencyKey = undefined,
  }: JobOptions<PayloadMap, T>,
): Promise<number> => {
  const client = await pool.connect();
  try {
    let result;
    const onConflict = idempotencyKey
      ? `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
      : '';

    if (runAt) {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, run_at, timeout_ms, force_kill_on_timeout, tags, idempotency_key) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         ${onConflict}
         RETURNING id`,
        [
          jobType,
          payload,
          maxAttempts,
          priority,
          runAt,
          timeoutMs ?? null,
          forceKillOnTimeout ?? false,
          tags ?? null,
          idempotencyKey ?? null,
        ],
      );
    } else {
      result = await client.query(
        `INSERT INTO job_queue 
          (job_type, payload, max_attempts, priority, timeout_ms, force_kill_on_timeout, tags, idempotency_key) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         ${onConflict}
         RETURNING id`,
        [
          jobType,
          payload,
          maxAttempts,
          priority,
          timeoutMs ?? null,
          forceKillOnTimeout ?? false,
          tags ?? null,
          idempotencyKey ?? null,
        ],
      );
    }

    // If ON CONFLICT DO NOTHING was triggered, no rows are returned.
    // Look up the existing job by idempotency key.
    if (result.rows.length === 0 && idempotencyKey) {
      const existing = await client.query(
        `SELECT id FROM job_queue WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existing.rows.length > 0) {
        log(
          `Job with idempotency key "${idempotencyKey}" already exists (id: ${existing.rows[0].id}), returning existing job`,
        );
        return existing.rows[0].id;
      }
      // Should not happen, but fall through to throw
      throw new Error(
        `Failed to insert job and could not find existing job with idempotency key "${idempotencyKey}"`,
      );
    }

    const jobId = result.rows[0].id;
    log(
      `Added job ${jobId}: payload ${JSON.stringify(payload)}, ${runAt ? `runAt ${runAt.toISOString()}, ` : ''}priority ${priority}, maxAttempts ${maxAttempts}, jobType ${jobType}, tags ${JSON.stringify(tags)}${idempotencyKey ? `, idempotencyKey "${idempotencyKey}"` : ''}`,
    );
    await recordJobEvent(pool, jobId, JobEventType.Added, {
      jobType,
      payload,
      tags,
      idempotencyKey,
    });
    return jobId;
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
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue WHERE id = $1`,
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
      forceKillOnTimeout: job.forceKillOnTimeout,
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
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );

    log(`Found ${result.rows.length} jobs by status ${status}`);

    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      forceKillOnTimeout: job.forceKillOnTimeout,
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

    // Get and lock a batch of jobs (including waiting jobs whose wait has elapsed)
    // Note: attempts is NOT incremented for waiting jobs resuming -- only for normal/failed pickups
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'processing', 
          locked_at = NOW(), 
          locked_by = $1,
          attempts = CASE WHEN status = 'waiting' THEN attempts ELSE attempts + 1 END,
          updated_at = NOW(),
          pending_reason = NULL,
          started_at = COALESCE(started_at, NOW()),
          last_retried_at = CASE WHEN status != 'waiting' AND attempts > 0 THEN NOW() ELSE last_retried_at END,
          wait_until = NULL
      WHERE id IN (
        SELECT id FROM job_queue
        WHERE (
          (
            (status = 'pending' OR (status = 'failed' AND next_attempt_at <= NOW()))
            AND (attempts < max_attempts)
            AND run_at <= NOW()
          )
          OR (
            status = 'waiting'
            AND wait_until IS NOT NULL
            AND wait_until <= NOW()
            AND wait_token_id IS NULL
          )
        )
        ${jobTypeFilter}
        ORDER BY priority DESC, created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData"
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
      forceKillOnTimeout: job.forceKillOnTimeout,
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
 * Prolong a running job by updating its locked_at timestamp.
 * This prevents `reclaimStuckJobs` from reclaiming the job while it's still actively working.
 * Also records a 'prolonged' event.
 */
export const prolongJob = async (pool: Pool, jobId: number): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET locked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'processing'
    `,
      [jobId],
    );
    await recordJobEvent(pool, jobId, JobEventType.Prolonged);
  } catch (error) {
    log(`Error prolonging job ${jobId}: ${error}`);
    // Do not throw -- prolong is best-effort and should not kill the running job
  } finally {
    log(`Prolonged job ${jobId}`);
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
      SET status = 'cancelled', updated_at = NOW(), last_cancelled_at = NOW(),
          wait_until = NULL, wait_token_id = NULL
      WHERE id = $1 AND status IN ('pending', 'waiting')
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
 * Edit a pending job (only if still pending)
 */
export const editJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  jobId: number,
  updates: {
    payload?: PayloadMap[T];
    maxAttempts?: number;
    priority?: number;
    runAt?: Date | null;
    timeoutMs?: number | null;
    tags?: string[] | null;
  },
): Promise<void> => {
  const client = await pool.connect();
  try {
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    // Build dynamic UPDATE query based on provided fields
    if (updates.payload !== undefined) {
      updateFields.push(`payload = $${paramIdx++}`);
      params.push(updates.payload);
    }
    if (updates.maxAttempts !== undefined) {
      updateFields.push(`max_attempts = $${paramIdx++}`);
      params.push(updates.maxAttempts);
    }
    if (updates.priority !== undefined) {
      updateFields.push(`priority = $${paramIdx++}`);
      params.push(updates.priority);
    }
    if (updates.runAt !== undefined) {
      if (updates.runAt === null) {
        // null means run now (use current timestamp)
        updateFields.push(`run_at = NOW()`);
      } else {
        updateFields.push(`run_at = $${paramIdx++}`);
        params.push(updates.runAt);
      }
    }
    if (updates.timeoutMs !== undefined) {
      updateFields.push(`timeout_ms = $${paramIdx++}`);
      params.push(updates.timeoutMs ?? null);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIdx++}`);
      params.push(updates.tags ?? null);
    }

    // If no fields to update, return early
    if (updateFields.length === 0) {
      log(`No fields to update for job ${jobId}`);
      return;
    }

    // Always update updated_at timestamp
    updateFields.push(`updated_at = NOW()`);

    // Add jobId as the last parameter for WHERE clause
    params.push(jobId);

    const query = `
      UPDATE job_queue
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIdx} AND status = 'pending'
    `;

    await client.query(query, params);

    // Record edit event with metadata containing updated fields
    const metadata: any = {};
    if (updates.payload !== undefined) metadata.payload = updates.payload;
    if (updates.maxAttempts !== undefined)
      metadata.maxAttempts = updates.maxAttempts;
    if (updates.priority !== undefined) metadata.priority = updates.priority;
    if (updates.runAt !== undefined) metadata.runAt = updates.runAt;
    if (updates.timeoutMs !== undefined) metadata.timeoutMs = updates.timeoutMs;
    if (updates.tags !== undefined) metadata.tags = updates.tags;

    await recordJobEvent(pool, jobId, JobEventType.Edited, metadata);
    log(`Edited job ${jobId}: ${JSON.stringify(metadata)}`);
  } catch (error) {
    log(`Error editing job ${jobId}: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Edit all pending jobs matching the filters
 */
export const editAllPendingJobs = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  filters:
    | {
        jobType?: string;
        priority?: number;
        runAt?:
          | Date
          | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
        tags?: { values: string[]; mode?: TagQueryMode };
      }
    | undefined = undefined,
  updates: {
    payload?: PayloadMap[T];
    maxAttempts?: number;
    priority?: number;
    runAt?: Date | null;
    timeoutMs?: number;
    tags?: string[];
  },
): Promise<number> => {
  const client = await pool.connect();
  try {
    // Build SET clause from updates
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (updates.payload !== undefined) {
      updateFields.push(`payload = $${paramIdx++}`);
      params.push(updates.payload);
    }
    if (updates.maxAttempts !== undefined) {
      updateFields.push(`max_attempts = $${paramIdx++}`);
      params.push(updates.maxAttempts);
    }
    if (updates.priority !== undefined) {
      updateFields.push(`priority = $${paramIdx++}`);
      params.push(updates.priority);
    }
    if (updates.runAt !== undefined) {
      if (updates.runAt === null) {
        // null means run now (use current timestamp)
        updateFields.push(`run_at = NOW()`);
      } else {
        updateFields.push(`run_at = $${paramIdx++}`);
        params.push(updates.runAt);
      }
    }
    if (updates.timeoutMs !== undefined) {
      updateFields.push(`timeout_ms = $${paramIdx++}`);
      params.push(updates.timeoutMs ?? null);
    }
    if (updates.tags !== undefined) {
      updateFields.push(`tags = $${paramIdx++}`);
      params.push(updates.tags ?? null);
    }

    // If no fields to update, return early
    if (updateFields.length === 0) {
      log(`No fields to update for batch edit`);
      return 0;
    }

    // Always update updated_at timestamp
    updateFields.push(`updated_at = NOW()`);

    // Build WHERE clause from filters
    let query = `
      UPDATE job_queue
      SET ${updateFields.join(', ')}
      WHERE status = 'pending'`;

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
        if (filters.runAt instanceof Date) {
          query += ` AND run_at = $${paramIdx++}`;
          params.push(filters.runAt);
        } else if (typeof filters.runAt === 'object') {
          const ops = filters.runAt;
          if (ops.gt) {
            query += ` AND run_at > $${paramIdx++}`;
            params.push(ops.gt);
          }
          if (ops.gte) {
            query += ` AND run_at >= $${paramIdx++}`;
            params.push(ops.gte);
          }
          if (ops.lt) {
            query += ` AND run_at < $${paramIdx++}`;
            params.push(ops.lt);
          }
          if (ops.lte) {
            query += ` AND run_at <= $${paramIdx++}`;
            params.push(ops.lte);
          }
          if (ops.eq) {
            query += ` AND run_at = $${paramIdx++}`;
            params.push(ops.eq);
          }
        }
      }
      if (
        filters.tags &&
        filters.tags.values &&
        filters.tags.values.length > 0
      ) {
        const mode = filters.tags.mode || 'all';
        const tagValues = filters.tags.values;
        switch (mode) {
          case 'exact':
            query += ` AND tags = $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'all':
            query += ` AND tags @> $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'any':
            query += ` AND tags && $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'none':
            query += ` AND NOT (tags && $${paramIdx++})`;
            params.push(tagValues);
            break;
          default:
            query += ` AND tags @> $${paramIdx++}`;
            params.push(tagValues);
        }
      }
    }
    query += '\nRETURNING id';

    const result = await client.query(query, params);
    const editedCount = result.rowCount || 0;

    // Record edit event with metadata containing updated fields for each job
    const metadata: any = {};
    if (updates.payload !== undefined) metadata.payload = updates.payload;
    if (updates.maxAttempts !== undefined)
      metadata.maxAttempts = updates.maxAttempts;
    if (updates.priority !== undefined) metadata.priority = updates.priority;
    if (updates.runAt !== undefined) metadata.runAt = updates.runAt;
    if (updates.timeoutMs !== undefined) metadata.timeoutMs = updates.timeoutMs;
    if (updates.tags !== undefined) metadata.tags = updates.tags;

    // Record events for each affected job
    for (const row of result.rows) {
      await recordJobEvent(pool, row.id, JobEventType.Edited, metadata);
    }

    log(`Edited ${editedCount} pending jobs: ${JSON.stringify(metadata)}`);
    return editedCount;
  } catch (error) {
    log(`Error editing pending jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel all upcoming jobs (pending and scheduled in the future) with optional filters
 */
export const cancelAllUpcomingJobs = async (
  pool: Pool,
  filters?: {
    jobType?: string;
    priority?: number;
    runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
    tags?: { values: string[]; mode?: TagQueryMode };
  },
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
        if (filters.runAt instanceof Date) {
          query += ` AND run_at = $${paramIdx++}`;
          params.push(filters.runAt);
        } else if (typeof filters.runAt === 'object') {
          const ops = filters.runAt;
          if (ops.gt) {
            query += ` AND run_at > $${paramIdx++}`;
            params.push(ops.gt);
          }
          if (ops.gte) {
            query += ` AND run_at >= $${paramIdx++}`;
            params.push(ops.gte);
          }
          if (ops.lt) {
            query += ` AND run_at < $${paramIdx++}`;
            params.push(ops.lt);
          }
          if (ops.lte) {
            query += ` AND run_at <= $${paramIdx++}`;
            params.push(ops.lte);
          }
          if (ops.eq) {
            query += ` AND run_at = $${paramIdx++}`;
            params.push(ops.eq);
          }
        }
      }
      if (
        filters.tags &&
        filters.tags.values &&
        filters.tags.values.length > 0
      ) {
        const mode = filters.tags.mode || 'all';
        const tagValues = filters.tags.values;
        switch (mode) {
          case 'exact':
            query += ` AND tags = $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'all':
            query += ` AND tags @> $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'any':
            query += ` AND tags && $${paramIdx++}`;
            params.push(tagValues);
            break;
          case 'none':
            query += ` AND NOT (tags && $${paramIdx++})`;
            params.push(tagValues);
            break;
          default:
            query += ` AND tags @> $${paramIdx++}`;
            params.push(tagValues);
        }
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
      `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    log(`Found ${result.rows.length} jobs (all)`);
    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      forceKillOnTimeout: job.forceKillOnTimeout,
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
    let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData"
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
      forceKillOnTimeout: job.forceKillOnTimeout,
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

export const getJobs = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  filters?: {
    jobType?: string;
    priority?: number;
    runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
    tags?: { values: string[]; mode?: TagQueryMode };
  },
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> => {
  const client = await pool.connect();
  try {
    let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue`;
    const params: any[] = [];
    let where: string[] = [];
    let paramIdx = 1;
    if (filters) {
      if (filters.jobType) {
        where.push(`job_type = $${paramIdx++}`);
        params.push(filters.jobType);
      }
      if (filters.priority !== undefined) {
        where.push(`priority = $${paramIdx++}`);
        params.push(filters.priority);
      }
      if (filters.runAt) {
        if (filters.runAt instanceof Date) {
          where.push(`run_at = $${paramIdx++}`);
          params.push(filters.runAt);
        } else if (
          typeof filters.runAt === 'object' &&
          (filters.runAt.gt !== undefined ||
            filters.runAt.gte !== undefined ||
            filters.runAt.lt !== undefined ||
            filters.runAt.lte !== undefined ||
            filters.runAt.eq !== undefined)
        ) {
          const ops = filters.runAt as {
            gt?: Date;
            gte?: Date;
            lt?: Date;
            lte?: Date;
            eq?: Date;
          };
          if (ops.gt) {
            where.push(`run_at > $${paramIdx++}`);
            params.push(ops.gt);
          }
          if (ops.gte) {
            where.push(`run_at >= $${paramIdx++}`);
            params.push(ops.gte);
          }
          if (ops.lt) {
            where.push(`run_at < $${paramIdx++}`);
            params.push(ops.lt);
          }
          if (ops.lte) {
            where.push(`run_at <= $${paramIdx++}`);
            params.push(ops.lte);
          }
          if (ops.eq) {
            where.push(`run_at = $${paramIdx++}`);
            params.push(ops.eq);
          }
        }
      }
      if (
        filters.tags &&
        filters.tags.values &&
        filters.tags.values.length > 0
      ) {
        const mode = filters.tags.mode || 'all';
        const tagValues = filters.tags.values;
        switch (mode) {
          case 'exact':
            where.push(`tags = $${paramIdx++}`);
            params.push(tagValues);
            break;
          case 'all':
            where.push(`tags @> $${paramIdx++}`);
            params.push(tagValues);
            break;
          case 'any':
            where.push(`tags && $${paramIdx++}`);
            params.push(tagValues);
            break;
          case 'none':
            where.push(`NOT (tags && $${paramIdx++})`);
            params.push(tagValues);
            break;
          default:
            where.push(`tags @> $${paramIdx++}`);
            params.push(tagValues);
        }
      }
    }
    if (where.length > 0) {
      query += ` WHERE ${where.join(' AND ')}`;
    }
    // Always add LIMIT and OFFSET as the last parameters
    paramIdx = params.length + 1;
    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    params.push(limit, offset);
    const result = await client.query(query, params);
    log(`Found ${result.rows.length} jobs`);
    return result.rows.map((job) => ({
      ...job,
      payload: job.payload,
      timeoutMs: job.timeoutMs,
      forceKillOnTimeout: job.forceKillOnTimeout,
      failureReason: job.failureReason,
    }));
  } catch (error) {
    log(`Error getting jobs: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

// ── Wait support functions ───────────────────────────────────────────────────

/**
 * Transition a job to 'waiting' status with wait_until and/or wait_token_id.
 * Saves step_data so the handler can resume from where it left off.
 */
export const waitJob = async (
  pool: Pool,
  jobId: number,
  options: {
    waitUntil?: Date;
    waitTokenId?: string;
    stepData: Record<string, any>;
  },
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE job_queue
      SET status = 'waiting',
          wait_until = $2,
          wait_token_id = $3,
          step_data = $4,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
      [
        jobId,
        options.waitUntil ?? null,
        options.waitTokenId ?? null,
        JSON.stringify(options.stepData),
      ],
    );
    await recordJobEvent(pool, jobId, JobEventType.Waiting, {
      waitUntil: options.waitUntil?.toISOString() ?? null,
      waitTokenId: options.waitTokenId ?? null,
    });
  } catch (error) {
    log(`Error setting job ${jobId} to waiting: ${error}`);
    throw error;
  } finally {
    log(`Job ${jobId} set to waiting`);
    client.release();
  }
};

/**
 * Update step_data for a job. Called after each ctx.run() step completes
 * to persist intermediate progress.
 */
export const updateStepData = async (
  pool: Pool,
  jobId: number,
  stepData: Record<string, any>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE job_queue SET step_data = $2, updated_at = NOW() WHERE id = $1`,
      [jobId, JSON.stringify(stepData)],
    );
  } catch (error) {
    log(`Error updating step_data for job ${jobId}: ${error}`);
    // Best-effort: do not throw to avoid killing the running handler
  } finally {
    client.release();
  }
};

/**
 * Parse a timeout string like '10m', '1h', '24h', '7d' into milliseconds.
 */
function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid timeout format: "${timeout}". Expected format like "10m", "1h", "24h", "7d".`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown timeout unit: "${unit}"`);
  }
}

/**
 * Create a waitpoint token in the database.
 * The token can be used to pause a job until an external signal completes it.
 *
 * @param pool - The database pool
 * @param jobId - The job ID to associate with the token (null if created outside a handler)
 * @param options - Optional timeout and tags
 * @returns The created waitpoint token
 */
export const createWaitpoint = async (
  pool: Pool,
  jobId: number | null,
  options?: { timeout?: string; tags?: string[] },
): Promise<{ id: string }> => {
  const client = await pool.connect();
  try {
    const id = `wp_${randomUUID()}`;
    let timeoutAt: Date | null = null;

    if (options?.timeout) {
      const ms = parseTimeoutString(options.timeout);
      timeoutAt = new Date(Date.now() + ms);
    }

    await client.query(
      `INSERT INTO waitpoints (id, job_id, status, timeout_at, tags) VALUES ($1, $2, 'waiting', $3, $4)`,
      [id, jobId, timeoutAt, options?.tags ?? null],
    );

    log(`Created waitpoint ${id} for job ${jobId}`);
    return { id };
  } catch (error) {
    log(`Error creating waitpoint: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Complete a waitpoint token, optionally providing output data.
 * This also moves the associated job from 'waiting' back to 'pending' so
 * it gets picked up by the polling loop.
 */
export const completeWaitpoint = async (
  pool: Pool,
  tokenId: string,
  data?: any,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update the waitpoint
    const wpResult = await client.query(
      `UPDATE waitpoints SET status = 'completed', output = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'waiting'
       RETURNING job_id`,
      [tokenId, data != null ? JSON.stringify(data) : null],
    );

    if (wpResult.rows.length === 0) {
      await client.query('ROLLBACK');
      log(`Waitpoint ${tokenId} not found or already completed`);
      return;
    }

    const jobId = wpResult.rows[0].job_id;

    // Move the associated job back to 'pending' so it gets picked up
    if (jobId != null) {
      await client.query(
        `UPDATE job_queue
         SET status = 'pending', wait_token_id = NULL, wait_until = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'waiting'`,
        [jobId],
      );
    }

    await client.query('COMMIT');
    log(`Completed waitpoint ${tokenId} for job ${jobId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    log(`Error completing waitpoint ${tokenId}: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Retrieve a waitpoint token by its ID.
 */
export const getWaitpoint = async (
  pool: Pool,
  tokenId: string,
): Promise<WaitpointRecord | null> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, job_id AS "jobId", status, output, timeout_at AS "timeoutAt", created_at AS "createdAt", completed_at AS "completedAt", tags FROM waitpoints WHERE id = $1`,
      [tokenId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0] as WaitpointRecord;
  } catch (error) {
    log(`Error getting waitpoint ${tokenId}: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Expire timed-out waitpoint tokens and move their associated jobs back to 'pending'.
 * Should be called periodically (e.g., alongside reclaimStuckJobs).
 */
export const expireTimedOutWaitpoints = async (pool: Pool): Promise<number> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find and expire timed-out waitpoints
    const result = await client.query(
      `UPDATE waitpoints
       SET status = 'timed_out'
       WHERE status = 'waiting' AND timeout_at IS NOT NULL AND timeout_at <= NOW()
       RETURNING id, job_id`,
    );

    // Move associated jobs back to 'pending'
    for (const row of result.rows) {
      if (row.job_id != null) {
        await client.query(
          `UPDATE job_queue
           SET status = 'pending', wait_token_id = NULL, wait_until = NULL, updated_at = NOW()
           WHERE id = $1 AND status = 'waiting'`,
          [row.job_id],
        );
      }
    }

    await client.query('COMMIT');
    const count = result.rowCount || 0;
    if (count > 0) {
      log(`Expired ${count} timed-out waitpoints`);
    }
    return count;
  } catch (error) {
    await client.query('ROLLBACK');
    log(`Error expiring timed-out waitpoints: ${error}`);
    throw error;
  } finally {
    client.release();
  }
};
