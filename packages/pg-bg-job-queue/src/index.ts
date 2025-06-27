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
export const initJobQueue = async (
  config: JobQueueConfig,
): Promise<JobQueue> => {
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
      <T>(job: JobOptions<T>) => addJob(pool, job),
      config.verbose ?? false,
    ),
    getJob: withLogContext(
      (id: number) => getJob(pool, id),
      config.verbose ?? false,
    ),
    getJobsByStatus: withLogContext(
      (status: string, limit?: number, offset?: number) =>
        getJobsByStatus(pool, status, limit, offset),
      config.verbose ?? false,
    ),
    getAllJobs: withLogContext(
      (limit?: number, offset?: number) => getAllJobs(pool, limit, offset),
      config.verbose ?? false,
    ),
    retryJob: withLogContext(
      (jobId: number) => retryJob(pool, jobId),
      config.verbose ?? false,
    ),
    cleanupOldJobs: withLogContext(
      (daysToKeep?: number) => cleanupOldJobs(pool, daysToKeep),
      config.verbose ?? false,
    ),
    cancelJob: withLogContext(
      (jobId: number) => cancelJob(pool, jobId),
      config.verbose ?? false,
    ),
    cancelAllUpcomingJobs: withLogContext(
      (filters?: { job_type?: string; priority?: number; run_at?: Date }) =>
        cancelAllUpcomingJobs(pool, filters),
      config.verbose ?? false,
    ),

    // Job processing
    registerJobHandler: withLogContext(
      (...args: Parameters<typeof registerJobHandler>) => {
        registerJobHandler(...args);
        return Promise.resolve();
      },
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
