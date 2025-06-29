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
  getJobEvents,
} from './queue.js';
import { createProcessor } from './processor.js';
import {
  JobQueueConfig,
  JobQueue,
  JobOptions,
  ProcessorOptions,
  JobHandlers,
} from './types.js';
import { setLogContext } from './log-context.js';
import { createPool } from './db-util.js';

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
    createProcessor: (
      handlers: JobHandlers<PayloadMap>,
      options?: ProcessorOptions,
    ) => createProcessor<PayloadMap>(pool, handlers, options),
    // Advanced access (for custom operations)
    getPool: () => pool,
    // Job events
    getJobEvents: withLogContext(
      (jobId: number) => getJobEvents(pool, jobId),
      config.verbose ?? false,
    ),
  };
};

const withLogContext =
  <T>(fn: (...args: any[]) => T, verbose: boolean) =>
  (...args: Parameters<typeof fn>): ReturnType<typeof fn> => {
    setLogContext(verbose);
    return fn(...args);
  };

export * from './types.js';
