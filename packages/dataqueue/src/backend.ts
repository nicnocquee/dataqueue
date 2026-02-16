import {
  JobOptions,
  JobRecord,
  JobEvent,
  JobEventType,
  FailureReason,
  TagQueryMode,
  JobType,
  CronScheduleRecord,
  CronScheduleStatus,
  EditCronScheduleOptions,
  WaitpointRecord,
  CreateTokenOptions,
} from './types.js';

/**
 * Filter options used by getJobs, cancelAllUpcomingJobs, editAllPendingJobs
 */
export interface JobFilters {
  jobType?: string;
  priority?: number;
  runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
  tags?: { values: string[]; mode?: TagQueryMode };
  /**
   * Cursor for keyset pagination. When provided, only return jobs with id < cursor.
   * This is more efficient than OFFSET for large datasets.
   * Cannot be used together with offset.
   */
  cursor?: number;
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
 * Input shape for creating a cron schedule in the backend.
 * This is the backend-level version of CronScheduleOptions.
 */
export interface CronScheduleInput {
  scheduleName: string;
  cronExpression: string;
  jobType: string;
  payload: any;
  maxAttempts: number;
  priority: number;
  timeoutMs: number | null;
  forceKillOnTimeout: boolean;
  tags: string[] | undefined;
  timezone: string;
  allowOverlap: boolean;
  nextRunAt: Date | null;
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

  /** Delete completed jobs older than N days. Deletes in batches for scale safety. Returns count deleted. */
  cleanupOldJobs(daysToKeep?: number, batchSize?: number): Promise<number>;

  /** Delete job events older than N days. Deletes in batches for scale safety. Returns count deleted. */
  cleanupOldJobEvents(daysToKeep?: number, batchSize?: number): Promise<number>;

  /** Reclaim jobs stuck in 'processing' for too long. Returns count. */
  reclaimStuckJobs(maxProcessingTimeMinutes?: number): Promise<number>;

  // ── Progress ──────────────────────────────────────────────────────────

  /** Update the progress percentage (0-100) for a job. */
  updateProgress(jobId: number, progress: number): Promise<void>;

  // ── Events ────────────────────────────────────────────────────────────

  /** Record a job event. Should not throw. */
  recordJobEvent(
    jobId: number,
    eventType: JobEventType,
    metadata?: any,
  ): Promise<void>;

  /** Get all events for a job, ordered by createdAt ASC. */
  getJobEvents(jobId: number): Promise<JobEvent[]>;

  // ── Cron schedules ──────────────────────────────────────────────────

  /** Create a cron schedule and return its ID. */
  addCronSchedule(input: CronScheduleInput): Promise<number>;

  /** Get a cron schedule by ID, or null if not found. */
  getCronSchedule(id: number): Promise<CronScheduleRecord | null>;

  /** Get a cron schedule by its unique name, or null if not found. */
  getCronScheduleByName(name: string): Promise<CronScheduleRecord | null>;

  /** List cron schedules, optionally filtered by status. */
  listCronSchedules(status?: CronScheduleStatus): Promise<CronScheduleRecord[]>;

  /** Delete a cron schedule by ID. */
  removeCronSchedule(id: number): Promise<void>;

  /** Pause a cron schedule. */
  pauseCronSchedule(id: number): Promise<void>;

  /** Resume a cron schedule. */
  resumeCronSchedule(id: number): Promise<void>;

  /** Edit a cron schedule. */
  editCronSchedule(
    id: number,
    updates: EditCronScheduleOptions,
    nextRunAt?: Date | null,
  ): Promise<void>;

  /**
   * Atomically fetch all active cron schedules whose nextRunAt <= now.
   * In PostgreSQL this uses FOR UPDATE SKIP LOCKED to prevent duplicate enqueuing.
   */
  getDueCronSchedules(): Promise<CronScheduleRecord[]>;

  /**
   * Update a cron schedule after a job has been enqueued.
   * Sets lastEnqueuedAt, lastJobId, and advances nextRunAt.
   */
  updateCronScheduleAfterEnqueue(
    id: number,
    lastEnqueuedAt: Date,
    lastJobId: number,
    nextRunAt: Date | null,
  ): Promise<void>;

  // ── Wait / step-data support ────────────────────────────────────────

  /**
   * Transition a job from 'processing' to 'waiting' status.
   * Persists step data so the handler can resume from where it left off.
   *
   * @param jobId - The job to pause.
   * @param options - Wait configuration including optional waitUntil date, token ID, and step data.
   */
  waitJob(
    jobId: number,
    options: {
      waitUntil?: Date;
      waitTokenId?: string;
      stepData: Record<string, any>;
    },
  ): Promise<void>;

  /**
   * Persist step data for a job. Called after each `ctx.run()` step completes
   * to save intermediate progress. Best-effort: should not throw.
   *
   * @param jobId - The job to update.
   * @param stepData - The step data to persist.
   */
  updateStepData(jobId: number, stepData: Record<string, any>): Promise<void>;

  /**
   * Create a waitpoint token that can pause a job until an external signal completes it.
   *
   * @param jobId - The job ID to associate with the token (null if created outside a handler).
   * @param options - Optional timeout string (e.g. '10m', '1h') and tags.
   * @returns The created waitpoint with its unique ID.
   */
  createWaitpoint(
    jobId: number | null,
    options?: CreateTokenOptions,
  ): Promise<{ id: string }>;

  /**
   * Complete a waitpoint token, optionally providing output data.
   * Moves the associated job from 'waiting' back to 'pending' so it gets picked up.
   *
   * @param tokenId - The waitpoint token ID to complete.
   * @param data - Optional data to pass to the waiting handler.
   */
  completeWaitpoint(tokenId: string, data?: any): Promise<void>;

  /**
   * Retrieve a waitpoint token by its ID.
   *
   * @param tokenId - The waitpoint token ID to look up.
   * @returns The waitpoint record, or null if not found.
   */
  getWaitpoint(tokenId: string): Promise<WaitpointRecord | null>;

  /**
   * Expire timed-out waitpoint tokens and move their associated jobs back to 'pending'.
   * Should be called periodically (e.g., alongside reclaimStuckJobs).
   *
   * @returns The number of tokens that were expired.
   */
  expireTimedOutWaitpoints(): Promise<number>;

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Set a pending reason for unpicked jobs of a given type. */
  setPendingReasonForUnpickedJobs(
    reason: string,
    jobType?: string | string[],
  ): Promise<void>;
}
