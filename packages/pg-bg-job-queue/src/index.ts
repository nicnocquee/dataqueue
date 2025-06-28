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
import { createProcessor, registerJobHandlers } from './processor.js';
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
    addJob: withLogContext(
      (job: JobOptions<PayloadMap, any>) => addJob<PayloadMap, any>(pool, job),
      config.verbose ?? false,
    ),
    getJob: withLogContext(
      (id: number) => getJob<PayloadMap, any>(pool, id),
      config.verbose ?? false,
    ),
    getJobsByStatus: withLogContext(
      (status: string, limit?: number, offset?: number) =>
        getJobsByStatus<PayloadMap, any>(pool, status, limit, offset),
      config.verbose ?? false,
    ),
    getAllJobs: withLogContext(
      (limit?: number, offset?: number) =>
        getAllJobs<PayloadMap, any>(pool, limit, offset),
      config.verbose ?? false,
    ),
    retryJob: (jobId: number) => retryJob(pool, jobId),
    cleanupOldJobs: (daysToKeep?: number) => cleanupOldJobs(pool, daysToKeep),
    cancelJob: withLogContext(
      (jobId: number) => cancelJob(pool, jobId),
      config.verbose ?? false,
    ),
    cancelAllUpcomingJobs: withLogContext(
      (filters?: { job_type?: string; priority?: number; run_at?: Date }) =>
        cancelAllUpcomingJobs(pool, filters),
      config.verbose ?? false,
    ),
    reclaimStuckJobs: withLogContext(
      (maxProcessingTimeMinutes?: number) =>
        reclaimStuckJobs(pool, maxProcessingTimeMinutes),
      config.verbose ?? false,
    ),

    // Job processing
    registerJobHandlers: withLogContext(
      (handlers: {
        [K in keyof PayloadMap]: (payload: PayloadMap[K]) => Promise<void>;
      }) => registerJobHandlers(handlers),
      config.verbose ?? false,
    ),
    createProcessor: withLogContext(
      (options?: ProcessorOptions) => createProcessor(pool, options),
      config.verbose ?? false,
    ),
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
