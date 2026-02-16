/**
 * Backward-compatible re-exports.
 * All SQL logic has moved to backends/postgres.ts (PostgresBackend class).
 * These functions delegate to a temporary PostgresBackend instance so that
 * any existing internal callers continue to work.
 *
 * Wait-related functions (waitJob, updateStepData, createWaitpoint, etc.)
 * are PostgreSQL-only and use direct SQL queries.
 */
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
import { PostgresBackend } from './backends/postgres.js';
import { randomUUID } from 'crypto';
import { log } from './log-context.js';

/* Thin wrappers — every function creates a lightweight backend wrapper
   around the given pool and forwards the call.  The class itself holds
   no mutable state so this is safe and cheap. */

export const recordJobEvent = async (
  pool: Pool,
  jobId: number,
  eventType: JobEventType,
  metadata?: any,
): Promise<void> =>
  new PostgresBackend(pool).recordJobEvent(jobId, eventType, metadata);

export const addJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  job: JobOptions<PayloadMap, T>,
): Promise<number> => new PostgresBackend(pool).addJob(job);

export const getJob = async <PayloadMap, T extends keyof PayloadMap & string>(
  pool: Pool,
  id: number,
): Promise<JobRecord<PayloadMap, T> | null> =>
  new PostgresBackend(pool).getJob<PayloadMap, T>(id);

export const getJobsByStatus = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  status: string,
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> =>
  new PostgresBackend(pool).getJobsByStatus<PayloadMap, T>(
    status,
    limit,
    offset,
  );

export const getNextBatch = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  workerId: string,
  batchSize = 10,
  jobType?: string | string[],
): Promise<JobRecord<PayloadMap, T>[]> =>
  new PostgresBackend(pool).getNextBatch<PayloadMap, T>(
    workerId,
    batchSize,
    jobType,
  );

export const completeJob = async (pool: Pool, jobId: number): Promise<void> =>
  new PostgresBackend(pool).completeJob(jobId);

export const prolongJob = async (pool: Pool, jobId: number): Promise<void> =>
  new PostgresBackend(pool).prolongJob(jobId);

export const failJob = async (
  pool: Pool,
  jobId: number,
  error: Error,
  failureReason?: FailureReason,
): Promise<void> =>
  new PostgresBackend(pool).failJob(jobId, error, failureReason);

export const retryJob = async (pool: Pool, jobId: number): Promise<void> =>
  new PostgresBackend(pool).retryJob(jobId);

export const cleanupOldJobs = async (
  pool: Pool,
  daysToKeep = 30,
  batchSize = 1000,
): Promise<number> =>
  new PostgresBackend(pool).cleanupOldJobs(daysToKeep, batchSize);

export const cancelJob = async (pool: Pool, jobId: number): Promise<void> =>
  new PostgresBackend(pool).cancelJob(jobId);

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
): Promise<void> => new PostgresBackend(pool).editJob(jobId, updates);

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
    | undefined,
  updates: {
    payload?: PayloadMap[T];
    maxAttempts?: number;
    priority?: number;
    runAt?: Date | null;
    timeoutMs?: number;
    tags?: string[];
  },
): Promise<number> =>
  new PostgresBackend(pool).editAllPendingJobs(filters, updates);

export const cancelAllUpcomingJobs = async (
  pool: Pool,
  filters?: {
    jobType?: string;
    priority?: number;
    runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
    tags?: { values: string[]; mode?: TagQueryMode };
  },
): Promise<number> => new PostgresBackend(pool).cancelAllUpcomingJobs(filters);

export const getAllJobs = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> =>
  new PostgresBackend(pool).getAllJobs<PayloadMap, T>(limit, offset);

export const setPendingReasonForUnpickedJobs = async (
  pool: Pool,
  reason: string,
  jobType?: string | string[],
): Promise<void> =>
  new PostgresBackend(pool).setPendingReasonForUnpickedJobs(reason, jobType);

export const reclaimStuckJobs = async (
  pool: Pool,
  maxProcessingTimeMinutes = 10,
): Promise<number> =>
  new PostgresBackend(pool).reclaimStuckJobs(maxProcessingTimeMinutes);

export const getJobEvents = async (
  pool: Pool,
  jobId: number,
): Promise<JobEvent[]> => new PostgresBackend(pool).getJobEvents(jobId);

export const getJobsByTags = async <
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  pool: Pool,
  tags: string[],
  mode: TagQueryMode = 'all',
  limit = 100,
  offset = 0,
): Promise<JobRecord<PayloadMap, T>[]> =>
  new PostgresBackend(pool).getJobsByTags<PayloadMap, T>(
    tags,
    mode,
    limit,
    offset,
  );

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
): Promise<JobRecord<PayloadMap, T>[]> =>
  new PostgresBackend(pool).getJobs<PayloadMap, T>(filters, limit, offset);

// ── Progress ──────────────────────────────────────────────────────────────────

export const updateProgress = async (
  pool: Pool,
  jobId: number,
  progress: number,
): Promise<void> => new PostgresBackend(pool).updateProgress(jobId, progress);

// ── Wait support functions (PostgreSQL-only) ─────────────────────────────────

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
    const result = await client.query(
      `
      UPDATE job_queue
      SET status = 'waiting',
          wait_until = $2,
          wait_token_id = $3,
          step_data = $4,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE id = $1 AND status = 'processing'
    `,
      [
        jobId,
        options.waitUntil ?? null,
        options.waitTokenId ?? null,
        JSON.stringify(options.stepData),
      ],
    );
    if (result.rowCount === 0) {
      log(
        `Job ${jobId} could not be set to waiting (may have been reclaimed or is no longer processing)`,
      );
      return;
    }
    await recordJobEvent(pool, jobId, JobEventType.Waiting, {
      waitUntil: options.waitUntil?.toISOString() ?? null,
      waitTokenId: options.waitTokenId ?? null,
    });
    log(`Job ${jobId} set to waiting`);
  } catch (error) {
    log(`Error setting job ${jobId} to waiting: ${error}`);
    throw error;
  } finally {
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
/**
 * Maximum allowed timeout in milliseconds (~365 days).
 * Prevents overflow to Infinity when computing Date offsets.
 */
const MAX_TIMEOUT_MS = 365 * 24 * 60 * 60 * 1000;

function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid timeout format: "${timeout}". Expected format like "10m", "1h", "24h", "7d".`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  let ms: number;
  switch (unit) {
    case 's':
      ms = value * 1000;
      break;
    case 'm':
      ms = value * 60 * 1000;
      break;
    case 'h':
      ms = value * 60 * 60 * 1000;
      break;
    case 'd':
      ms = value * 24 * 60 * 60 * 1000;
      break;
    default:
      throw new Error(`Unknown timeout unit: "${unit}"`);
  }
  if (!Number.isFinite(ms) || ms > MAX_TIMEOUT_MS) {
    throw new Error(
      `Timeout value "${timeout}" is too large. Maximum allowed is 365 days.`,
    );
  }
  return ms;
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
