import { Pool } from 'pg';

// Utility type for job type keys
export type JobType<PayloadMap> = keyof PayloadMap & string;

export interface JobOptions<PayloadMap, T extends JobType<PayloadMap>> {
  job_type: T;
  payload: PayloadMap[T];
  max_attempts?: number;
  priority?: number;
  run_at?: Date | null;
  /**
   * Timeout for this job in milliseconds. If not set, uses the processor default or unlimited.
   */
  timeoutMs?: number;
}

export enum FailureReason {
  Timeout = 'timeout',
  HandlerError = 'handler_error',
  NoHandler = 'no_handler',
}

export interface JobRecord<PayloadMap, T extends JobType<PayloadMap>> {
  id: number;
  job_type: T;
  payload: PayloadMap[T];
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  created_at: Date;
  updated_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  priority: number;
  run_at: Date;
  pending_reason?: string | null;
  error_history?: { message: string; timestamp: string }[];
  /**
   * Timeout for this job in milliseconds (null means no timeout).
   */
  timeout_ms?: number | null;
  /**
   * The reason for the last failure, if any.
   */
  failure_reason?: FailureReason | null;
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
   * - The jobs are returned in descending order of created_at.
   */
  getJobsByStatus: <T extends JobType<PayloadMap>>(
    status: string,
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
   *   - job_type: The job type to cancel.
   *   - priority: The priority of the job to cancel.
   *   - run_at: The time the job is scheduled to run at.
   */
  cancelAllUpcomingJobs: (filters?: {
    job_type?: string;
    priority?: number;
    run_at?: Date;
  }) => Promise<number>;
  /**
   * Create a job processor. Handlers must be provided per-processor.
   */
  createProcessor: (
    handlers: {
      [K in keyof PayloadMap]: JobHandler<PayloadMap, K>;
    },
    options?: ProcessorOptions,
  ) => Processor;
  /**
   * Get the database pool.
   */
  getPool: () => Pool;
}
