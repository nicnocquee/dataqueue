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
  AddJobOptions,
} from './types.js';
import { PostgresBackend } from './backends/postgres.js';

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
  options?: AddJobOptions,
): Promise<number> => new PostgresBackend(pool).addJob(job, options);

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
    retryDelay?: number | null;
    retryBackoff?: boolean | null;
    retryDelayMax?: number | null;
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
    retryDelay?: number | null;
    retryBackoff?: boolean | null;
    retryDelayMax?: number | null;
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

// ── Wait support functions (backward-compatible delegates) ────────────────────

/** @deprecated Use backend.waitJob() directly. Delegates to PostgresBackend. */
export const waitJob = async (
  pool: Pool,
  jobId: number,
  options: {
    waitUntil?: Date;
    waitTokenId?: string;
    stepData: Record<string, any>;
  },
): Promise<void> => new PostgresBackend(pool).waitJob(jobId, options);

/** @deprecated Use backend.updateStepData() directly. Delegates to PostgresBackend. */
export const updateStepData = async (
  pool: Pool,
  jobId: number,
  stepData: Record<string, any>,
): Promise<void> => new PostgresBackend(pool).updateStepData(jobId, stepData);

/** @deprecated Use backend.createWaitpoint() directly. Delegates to PostgresBackend. */
export const createWaitpoint = async (
  pool: Pool,
  jobId: number | null,
  options?: { timeout?: string; tags?: string[] },
): Promise<{ id: string }> =>
  new PostgresBackend(pool).createWaitpoint(jobId, options);

/** @deprecated Use backend.completeWaitpoint() directly. Delegates to PostgresBackend. */
export const completeWaitpoint = async (
  pool: Pool,
  tokenId: string,
  data?: any,
): Promise<void> => new PostgresBackend(pool).completeWaitpoint(tokenId, data);

/** @deprecated Use backend.getWaitpoint() directly. Delegates to PostgresBackend. */
export const getWaitpoint = async (
  pool: Pool,
  tokenId: string,
): Promise<WaitpointRecord | null> =>
  new PostgresBackend(pool).getWaitpoint(tokenId);

/** @deprecated Use backend.expireTimedOutWaitpoints() directly. Delegates to PostgresBackend. */
export const expireTimedOutWaitpoints = async (pool: Pool): Promise<number> =>
  new PostgresBackend(pool).expireTimedOutWaitpoints();
