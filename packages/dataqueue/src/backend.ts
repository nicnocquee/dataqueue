import {
  JobOptions,
  JobRecord,
  JobEvent,
  JobEventType,
  FailureReason,
  TagQueryMode,
  JobType,
} from './types.js';

/**
 * Filter options used by getJobs, cancelAllUpcomingJobs, editAllPendingJobs
 */
export interface JobFilters {
  jobType?: string;
  priority?: number;
  runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
  tags?: { values: string[]; mode?: TagQueryMode };
}

/**
 * Fields that can be updated on a job
 */
export interface JobUpdates {
  payload?: any;
  maxAttempts?: number;
  priority?: number;
  runAt?: Date | null;
  timeoutMs?: number | null;
  tags?: string[] | null;
}

/**
 * Abstract backend interface that both PostgreSQL and Redis implement.
 * All storage operations go through this interface so the processor
 * and public API are backend-agnostic.
 */
export interface QueueBackend {
  // ── Job CRUD ──────────────────────────────────────────────────────────

  /** Add a job and return its numeric ID. */
  addJob<PayloadMap, T extends JobType<PayloadMap>>(
    job: JobOptions<PayloadMap, T>,
  ): Promise<number>;

  /** Get a single job by ID, or null if not found. */
  getJob<PayloadMap, T extends JobType<PayloadMap>>(
    id: number,
  ): Promise<JobRecord<PayloadMap, T> | null>;

  /** Get jobs filtered by status, ordered by createdAt DESC. */
  getJobsByStatus<PayloadMap, T extends JobType<PayloadMap>>(
    status: string,
    limit?: number,
    offset?: number,
  ): Promise<JobRecord<PayloadMap, T>[]>;

  /** Get all jobs, ordered by createdAt DESC. */
  getAllJobs<PayloadMap, T extends JobType<PayloadMap>>(
    limit?: number,
    offset?: number,
  ): Promise<JobRecord<PayloadMap, T>[]>;

  /** Get jobs matching arbitrary filters, ordered by createdAt DESC. */
  getJobs<PayloadMap, T extends JobType<PayloadMap>>(
    filters?: JobFilters,
    limit?: number,
    offset?: number,
  ): Promise<JobRecord<PayloadMap, T>[]>;

  /** Get jobs by tag(s) with query mode. */
  getJobsByTags<PayloadMap, T extends JobType<PayloadMap>>(
    tags: string[],
    mode?: TagQueryMode,
    limit?: number,
    offset?: number,
  ): Promise<JobRecord<PayloadMap, T>[]>;

  // ── Processing lifecycle ──────────────────────────────────────────────

  /**
   * Atomically claim a batch of ready jobs for the given worker.
   * Equivalent to SELECT … FOR UPDATE SKIP LOCKED in Postgres.
   */
  getNextBatch<PayloadMap, T extends JobType<PayloadMap>>(
    workerId: string,
    batchSize?: number,
    jobType?: string | string[],
  ): Promise<JobRecord<PayloadMap, T>[]>;

  /** Mark a job as completed. */
  completeJob(jobId: number): Promise<void>;

  /** Mark a job as failed with error info and schedule retry. */
  failJob(
    jobId: number,
    error: Error,
    failureReason?: FailureReason,
  ): Promise<void>;

  /** Update locked_at to keep the job alive (heartbeat). */
  prolongJob(jobId: number): Promise<void>;

  // ── Job management ────────────────────────────────────────────────────

  /** Retry a failed/cancelled job immediately. */
  retryJob(jobId: number): Promise<void>;

  /** Cancel a pending job. */
  cancelJob(jobId: number): Promise<void>;

  /** Cancel all pending jobs matching optional filters. Returns count. */
  cancelAllUpcomingJobs(filters?: JobFilters): Promise<number>;

  /** Edit a single pending job. */
  editJob(jobId: number, updates: JobUpdates): Promise<void>;

  /** Edit all pending jobs matching filters. Returns count. */
  editAllPendingJobs(
    filters: JobFilters | undefined,
    updates: JobUpdates,
  ): Promise<number>;

  /** Delete completed jobs older than N days. Returns count deleted. */
  cleanupOldJobs(daysToKeep?: number): Promise<number>;

  /** Reclaim jobs stuck in 'processing' for too long. Returns count. */
  reclaimStuckJobs(maxProcessingTimeMinutes?: number): Promise<number>;

  // ── Events ────────────────────────────────────────────────────────────

  /** Record a job event. Should not throw. */
  recordJobEvent(
    jobId: number,
    eventType: JobEventType,
    metadata?: any,
  ): Promise<void>;

  /** Get all events for a job, ordered by createdAt ASC. */
  getJobEvents(jobId: number): Promise<JobEvent[]>;

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Set a pending reason for unpicked jobs of a given type. */
  setPendingReasonForUnpickedJobs(
    reason: string,
    jobType?: string | string[],
  ): Promise<void>;
}
