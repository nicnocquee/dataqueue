import { Pool } from 'pg';

export interface JobOptions<T> {
  job_type: string;
  payload: T;
  max_attempts?: number;
  priority?: number;
  run_at?: Date | null;
}

export interface JobRecord<T> {
  id: number;
  job_type: string;
  payload: T;
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
}

export interface JobHandler<T> {
  handler: (payload: T) => Promise<void>;
}

export interface ProcessorOptions {
  workerId?: string;
  /**
   * The number of jobs to process at a time.
   * - If not provided, the processor will process 10 jobs at a time.
   * - In serverless functions, it's better to process less jobs at a time since serverless functions are charged by the second and have a timeout.
   */
  batchSize?: number;
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

export interface JobQueue {
  /**
   * Add a job to the job queue.
   */
  addJob: <T>(job: JobOptions<T>) => Promise<number>;
  /**
   * Get a job by its ID.
   */
  getJob: <T>(id: number) => Promise<JobRecord<T> | null>;
  /**
   * Get jobs by their status.
   */
  getJobsByStatus: <T>(
    status: string,
    limit?: number,
    offset?: number,
  ) => Promise<JobRecord<T>[]>;
  /**
   * Get all jobs.
   */
  getAllJobs: <T>(limit?: number, offset?: number) => Promise<JobRecord<T>[]>;
  /**
   * Retry a job.
   */
  retryJob: (jobId: number) => Promise<void>;
  /**
   * Cleanup old jobs.
   */
  cleanupOldJobs: (daysToKeep?: number) => Promise<number>;
  /**
   * Cancel a job.
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
   * Cancel all upcoming jobs.
   */
  cancelAllUpcomingJobs: (filters?: {
    job_type?: string;
    priority?: number;
    run_at?: Date;
  }) => Promise<number>;
  /**
   * Register a job handler.
   */
  registerJobHandler: (
    jobType: string,
    handler: (payload: Record<string, any>) => Promise<void>,
  ) => void;
  /**
   * Create a job processor.
   */
  createProcessor: (options?: ProcessorOptions) => Processor;
  /**
   * Get the database pool.
   */
  getPool: () => Pool;
}
