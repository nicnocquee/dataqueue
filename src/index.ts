import { createPool, initializeJobQueue, runMigrations } from './setup.js';
import {
  addJob,
  getJob,
  getJobsByStatus,
  retryJob,
  cleanupOldJobs,
  cancelJob,
} from './queue.js';
import { registerJobHandler, createProcessor } from './processor.js';
import {
  JobQueueConfig,
  JobQueue,
  JobOptions,
  ProcessorOptions,
} from './types.js';

/**
 * Initialize the job queue system
 */
export const initJobQueue = async (
  config: JobQueueConfig,
): Promise<JobQueue> => {
  const { databaseConfig } = config;

  // Create database pool
  const pool = createPool(databaseConfig);

  // Initialize database tables
  await initializeJobQueue(pool);

  // Run migrations if needed
  await runMigrations(pool);

  // Return the job queue API
  return {
    // Job queue operations
    addJob: (job: JobOptions) => addJob(pool, job),
    getJob: (id: number) => getJob(pool, id),
    getJobsByStatus: (status: string, limit?: number, offset?: number) =>
      getJobsByStatus(pool, status, limit, offset),
    retryJob: (jobId: number) => retryJob(pool, jobId),
    cleanupOldJobs: (daysToKeep?: number) => cleanupOldJobs(pool, daysToKeep),
    cancelJob: (jobId: number) => cancelJob(pool, jobId),

    // Job processing
    registerJobHandler,
    createProcessor: (options?: ProcessorOptions) =>
      createProcessor(pool, options),

    // Advanced access (for custom operations)
    getPool: () => pool,
  };
};

export * from './types.js';
