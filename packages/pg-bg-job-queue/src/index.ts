import { createPool, initializeJobQueue, runMigrations } from './setup.js';
import {
  addJob,
  getJob,
  getJobsByStatus,
  retryJob,
  cleanupOldJobs,
  cancelJob,
  cancelAllUpcomingJobs,
  getAllJobs,
  reclaimStuckJobs,
} from './queue.js';
import { registerJobHandler, createProcessor } from './processor.js';
import {
  JobQueueConfig,
  JobQueue,
  JobOptions,
  ProcessorOptions,
} from './types.js';
import { setLogContext } from './log-context.js';

/**
 * Initialize the job queue system
 */
export const initJobQueue = async <PayloadMap = any>(
  config: JobQueueConfig,
): Promise<JobQueue<PayloadMap>> => {
  const { databaseConfig } = config;

  // Create database pool
  const pool = createPool(databaseConfig);

  setLogContext(config.verbose ?? false);

  // Initialize database tables
  await initializeJobQueue(pool);

  // Run migrations if needed
  await runMigrations(pool);

  // Return the job queue API
  return {
    // Job queue operations
    addJob: (job: JobOptions<PayloadMap, any>) =>
      addJob<PayloadMap, any>(pool, job),
    getJob: (id: number) => getJob<PayloadMap, any>(pool, id),
    getJobsByStatus: (status: string, limit?: number, offset?: number) =>
      getJobsByStatus<PayloadMap, any>(pool, status, limit, offset),
    getAllJobs: (limit?: number, offset?: number) =>
      getAllJobs<PayloadMap, any>(pool, limit, offset),
    retryJob: (jobId: number) => retryJob(pool, jobId),
    cleanupOldJobs: (daysToKeep?: number) => cleanupOldJobs(pool, daysToKeep),
    cancelJob: (jobId: number) => cancelJob(pool, jobId),
    cancelAllUpcomingJobs: (filters?: {
      job_type?: string;
      priority?: number;
      run_at?: Date;
    }) => cancelAllUpcomingJobs(pool, filters),
    reclaimStuckJobs: (maxProcessingTimeMinutes?: number) =>
      reclaimStuckJobs(pool, maxProcessingTimeMinutes),

    // Job processing
    registerJobHandler: (jobType: any, handler: any) =>
      registerJobHandler<PayloadMap, any>(jobType, handler),
    createProcessor: (options?: ProcessorOptions) =>
      createProcessor(pool, options),
    // Advanced access (for custom operations)
    getPool: () => pool,
  };
};

const withLogContext =
  <T>(fn: (...args: any[]) => T, verbose: boolean) =>
  (...args: Parameters<typeof fn>): ReturnType<typeof fn> => {
    setLogContext(verbose);
    return fn(...args);
  };

export * from './types.js';
