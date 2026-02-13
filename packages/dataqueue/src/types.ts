import { Pool } from 'pg';

// Utility type for job type keys
export type JobType<PayloadMap> = keyof PayloadMap & string;

export interface JobOptions<PayloadMap, T extends JobType<PayloadMap>> {
  jobType: T;
  payload: PayloadMap[T];
  maxAttempts?: number;
  priority?: number;
  runAt?: Date | null;
  /**
   * Timeout for this job in milliseconds. If not set, uses the processor default or unlimited.
   */
  timeoutMs?: number;
  /**
   * If true, the job will be forcefully terminated (using Worker Threads) when timeout is reached.
   * If false (default), the job will only receive an AbortSignal and must handle the abort gracefully.
   *
   * **⚠️ RUNTIME REQUIREMENTS**: This option requires **Node.js** and uses the `worker_threads` module.
   * It will **not work** in Bun or other runtimes that don't support Node.js worker threads.
   *
   * **IMPORTANT**: When `forceKillOnTimeout` is true, the handler must be serializable. This means:
   * - The handler should be a standalone function (not a closure over external variables)
   * - It should not capture variables from outer scopes that reference external dependencies
   * - It should not use 'this' context unless it's a bound method
   * - All dependencies must be importable in the worker thread context
   *
   * **Examples of serializable handlers:**
   * ```ts
   * // ✅ Good - standalone function
   * const handler = async (payload, signal) => {
   *   await doSomething(payload);
   * };
   *
   * // ✅ Good - function that imports dependencies
   * const handler = async (payload, signal) => {
   *   const { api } = await import('./api');
   *   await api.call(payload);
   * };
   *
   * // ❌ Bad - closure over external variable
   * const db = getDatabase();
   * const handler = async (payload, signal) => {
   *   await db.query(payload); // 'db' is captured from closure
   * };
   *
   * // ❌ Bad - uses 'this' context
   * class MyHandler {
   *   async handle(payload, signal) {
   *     await this.doSomething(payload); // 'this' won't work
   *   }
   * }
   * ```
   *
   * If your handler doesn't meet these requirements, use `forceKillOnTimeout: false` (default)
   * and ensure your handler checks `signal.aborted` to exit gracefully.
   *
   * Note: forceKillOnTimeout requires timeoutMs to be set.
   */
  forceKillOnTimeout?: boolean;
  /**
   * Tags for this job. Used for grouping, searching, or batch operations.
   */
  tags?: string[];
  /**
   * Optional idempotency key. When provided, ensures that only one job exists for a given key.
   * If a job with the same idempotency key already exists, `addJob` returns the existing job's ID
   * instead of creating a duplicate.
   *
   * Useful for preventing duplicate jobs caused by retries, double-clicks, webhook replays,
   * or serverless function re-invocations.
   *
   * The key is unique across the entire `job_queue` table regardless of job status.
   * Once a key exists, it cannot be reused until the job is cleaned up (via `cleanupOldJobs`).
   */
  idempotencyKey?: string;
}

/**
 * Options for editing a pending job.
 * All fields are optional and only provided fields will be updated.
 * Note: jobType cannot be changed.
 * timeoutMs and tags can be set to null to clear them.
 */
export type EditJobOptions<PayloadMap, T extends JobType<PayloadMap>> = Partial<
  Omit<JobOptions<PayloadMap, T>, 'jobType'>
> & {
  timeoutMs?: number | null;
  tags?: string[] | null;
};

export enum JobEventType {
  Added = 'added',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Retried = 'retried',
  Edited = 'edited',
}

export interface JobEvent {
  id: number;
  jobId: number;
  eventType: JobEventType;
  createdAt: Date;
  metadata: any;
}

export enum FailureReason {
  Timeout = 'timeout',
  HandlerError = 'handler_error',
  NoHandler = 'no_handler',
}

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRecord<PayloadMap, T extends JobType<PayloadMap>> {
  id: number;
  jobType: T;
  payload: PayloadMap[T];
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  priority: number;
  runAt: Date;
  pendingReason?: string | null;
  errorHistory?: { message: string; timestamp: string }[];
  /**
   * Timeout for this job in milliseconds (null means no timeout).
   */
  timeoutMs?: number | null;
  /**
   * If true, the job will be forcefully terminated (using Worker Threads) when timeout is reached.
   * If false (default), the job will only receive an AbortSignal and must handle the abort gracefully.
   */
  forceKillOnTimeout?: boolean | null;
  /**
   * The reason for the last failure, if any.
   */
  failureReason?: FailureReason | null;
  /**
   * The time the job was completed, if completed.
   */
  completedAt: Date | null;
  /**
   * The time the job was first picked up for processing.
   */
  startedAt: Date | null;
  /**
   * The time the job was last retried.
   */
  lastRetriedAt: Date | null;
  /**
   * The time the job last failed.
   */
  lastFailedAt: Date | null;
  /**
   * The time the job was last cancelled.
   */
  lastCancelledAt: Date | null;
  /**
   * Tags for this job. Used for grouping, searching, or batch operations.
   */
  tags?: string[];
  /**
   * The idempotency key for this job, if one was provided when the job was created.
   */
  idempotencyKey?: string | null;
}

export type JobHandler<PayloadMap, T extends keyof PayloadMap> = (
  payload: PayloadMap[T],
  signal: AbortSignal,
) => Promise<void>;

export type JobHandlers<PayloadMap> = {
  [K in keyof PayloadMap]: JobHandler<PayloadMap, K>;
};

export interface ProcessorOptions {
  workerId?: string;
  /**
   * The number of jobs to process at a time.
   * - If not provided, the processor will process 10 jobs at a time.
   * - In serverless functions, it's better to process less jobs at a time since serverless functions are charged by the second and have a timeout.
   */
  batchSize?: number;
  /**
   * The maximum number of jobs to process in parallel per batch.
   * - If not provided, all jobs in the batch are processed in parallel.
   * - Set to 1 to process jobs sequentially.
   * - Set to a lower value to avoid resource exhaustion.
   */
  concurrency?: number;
  /**
   * The interval in milliseconds to poll for new jobs.
   * - If not provided, the processor will process jobs every 5 seconds when startInBackground is called.
   * - In serverless functions, it's better to leave this empty.
   * - If you call start instead of startInBackground, the pollInterval is ignored.
   */
  pollInterval?: number;
  onError?: (error: Error) => void;
  verbose?: boolean;
  /**
   * Only process jobs with this job type (string or array of strings). If omitted, all job types are processed.
   */
  jobType?: string | string[];
}

export interface Processor {
  /**
   * Start the job processor in the background.
   * - This will run periodically (every pollInterval milliseconds or 5 seconds if not provided) and process jobs (as many as batchSize) as they become available.
   * - **You have to call the stop method to stop the processor.**
   * - Handlers are provided per-processor when calling createProcessor.
   * - In serverless functions, it's recommended to call start instead and await it to finish.
   */
  startInBackground: () => void;
  /**
   * Stop the job processor that runs in the background.
   */
  stop: () => void;
  /**
   * Check if the job processor is running.
   */
  isRunning: () => boolean;
  /**
   * Start the job processor synchronously.
   * - This will process jobs (as many as batchSize) immediately and then stop. The pollInterval is ignored.
   * - In serverless functions, it's recommended to use this instead of startInBackground.
   * - Returns the number of jobs processed.
   */
  start: () => Promise<number>;
}

export interface DatabaseSSLConfig {
  /**
   * CA certificate as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  ca?: string;
  /**
   * Client certificate as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  cert?: string;
  /**
   * Client private key as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  key?: string;
  /**
   * Whether to reject unauthorized certificates (default: true)
   */
  rejectUnauthorized?: boolean;
}

export interface JobQueueConfig {
  databaseConfig: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: DatabaseSSLConfig;
  };
  verbose?: boolean;
}

export type TagQueryMode = 'exact' | 'all' | 'any' | 'none';

export interface JobQueue<PayloadMap> {
  /**
   * Add a job to the job queue.
   */
  addJob: <T extends JobType<PayloadMap>>(
    job: JobOptions<PayloadMap, T>,
  ) => Promise<number>;
  /**
   * Get a job by its ID.
   */
  getJob: <T extends JobType<PayloadMap>>(
    id: number,
  ) => Promise<JobRecord<PayloadMap, T> | null>;
  /**
   * Get jobs by their status, with pagination.
   * - If no limit is provided, all jobs are returned.
   * - If no offset is provided, the first page is returned.
   * - The jobs are returned in descending order of createdAt.
   */
  getJobsByStatus: <T extends JobType<PayloadMap>>(
    status: JobStatus,
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord<PayloadMap, T>[]>;
  /**
   * Get jobs by tag(s).
   * - Modes:
   *   - 'exact': Jobs with exactly the same tags (no more, no less)
   *   - 'all': Jobs that have all the given tags (can have more)
   *   - 'any': Jobs that have at least one of the given tags
   *   - 'none': Jobs that have none of the given tags
   * - Default mode is 'all'.
   */
  getJobsByTags: <T extends JobType<PayloadMap>>(
    tags: string[],
    mode?: TagQueryMode,
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord<PayloadMap, T>[]>;
  /**
   * Get all jobs.
   */
  getAllJobs: <T extends JobType<PayloadMap>>(
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord<PayloadMap, T>[]>;
  /**
   * Get jobs by filters.
  /**
   * Get jobs by filters.
   */
  getJobs: <T extends JobType<PayloadMap>>(filters?: {
    jobType?: string;
    priority?: number;
    runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
    tags?: { values: string[]; mode?: TagQueryMode };
  }) => Promise<JobRecord<PayloadMap, T>[]>;
  /**
   * Retry a job given its ID.
   * - This will set the job status back to 'pending', clear the locked_at and locked_by, and allow it to be picked up by other workers.
   */
  retryJob: (jobId: number) => Promise<void>;
  /**
   * Cleanup jobs that are older than the specified number of days.
   */
  cleanupOldJobs: (daysToKeep?: number) => Promise<number>;
  /**
   * Cancel a job given its ID.
   * - This will set the job status to 'cancelled' and clear the locked_at and locked_by.
   */
  cancelJob: (jobId: number) => Promise<void>;
  /**
   * Edit a pending job given its ID.
   * - Only works for jobs with status 'pending'. Silently fails for other statuses.
   * - All fields in EditJobOptions are optional - only provided fields will be updated.
   * - jobType cannot be changed.
   * - Records an 'edited' event with the updated fields in metadata.
   */
  editJob: <T extends JobType<PayloadMap>>(
    jobId: number,
    updates: EditJobOptions<PayloadMap, T>,
  ) => Promise<void>;
  /**
   * Edit all pending jobs that match the filters.
   * - Only works for jobs with status 'pending'. Non-pending jobs are not affected.
   * - All fields in EditJobOptions are optional - only provided fields will be updated.
   * - jobType cannot be changed.
   * - Records an 'edited' event with the updated fields in metadata for each affected job.
   * - Returns the number of jobs that were edited.
   * - The filters are:
   *   - jobType: The job type to edit.
   *   - priority: The priority of the job to edit.
   *   - runAt: The time the job is scheduled to run at (now supports gt/gte/lt/lte/eq).
   *   - tags: An object with 'values' (string[]) and 'mode' (TagQueryMode) for tag-based editing.
   */
  editAllPendingJobs: <T extends JobType<PayloadMap>>(
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
    updates: EditJobOptions<PayloadMap, T>,
  ) => Promise<number>;
  /**
   * Reclaim stuck jobs.
   * - If a process (e.g., API route or worker) crashes after marking a job as 'processing' but before completing it, the job can remain stuck in the 'processing' state indefinitely. This can happen if the process is killed or encounters an unhandled error after updating the job status but before marking it as 'completed' or 'failed'.
   * - This function will set the job status back to 'pending', clear the locked_at and locked_by, and allow it to be picked up by other workers.
   * - The default max processing time is 10 minutes.
   */
  reclaimStuckJobs: (maxProcessingTimeMinutes?: number) => Promise<number>;
  /**
   * Cancel all upcoming jobs that match the filters.
   * - If no filters are provided, all upcoming jobs are cancelled.
   * - If filters are provided, only jobs that match the filters are cancelled.
   * - The filters are:
   *   - jobType: The job type to cancel.
   *   - priority: The priority of the job to cancel.
   *   - runAt: The time the job is scheduled to run at (now supports gt/gte/lt/lte/eq).
   *   - tags: An object with 'values' (string[]) and 'mode' (TagQueryMode) for tag-based cancellation.
   */
  cancelAllUpcomingJobs: (filters?: {
    jobType?: string;
    priority?: number;
    runAt?: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
    tags?: { values: string[]; mode?: TagQueryMode };
  }) => Promise<number>;
  /**
   * Create a job processor. Handlers must be provided per-processor.
   */
  createProcessor: (
    handlers: JobHandlers<PayloadMap>,
    options?: ProcessorOptions,
  ) => Processor;

  /**
   * Get the job events for a job.
   */
  getJobEvents: (jobId: number) => Promise<JobEvent[]>;
  /**
   * Get the database pool.
   */
  getPool: () => Pool;
}
