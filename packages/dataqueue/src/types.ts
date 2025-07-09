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
   * Tags for this job. Used for grouping, searching, or batch operations.
   */
  tags?: string[];
}

export enum JobEventType {
  Added = 'added',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Retried = 'retried',
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

export interface JobQueueConfig {
  databaseConfig: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: any;
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
