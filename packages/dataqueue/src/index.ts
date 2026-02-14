import { createProcessor } from './processor.js';
import {
  JobQueueConfig,
  JobQueue,
  JobOptions,
  ProcessorOptions,
  JobHandlers,
  JobType,
  PostgresJobQueueConfig,
  RedisJobQueueConfig,
} from './types.js';
import { QueueBackend } from './backend.js';
import { setLogContext } from './log-context.js';
import { createPool } from './db-util.js';
import { PostgresBackend } from './backends/postgres.js';
import { RedisBackend } from './backends/redis.js';

/**
 * Initialize the job queue system.
 *
 * Defaults to PostgreSQL when `backend` is omitted.
 */
export const initJobQueue = <PayloadMap = any>(
  config: JobQueueConfig,
): JobQueue<PayloadMap> => {
  const backendType = config.backend ?? 'postgres';
  setLogContext(config.verbose ?? false);

  let backend: QueueBackend;

  if (backendType === 'postgres') {
    const pgConfig = config as PostgresJobQueueConfig;
    const pool = createPool(pgConfig.databaseConfig);
    backend = new PostgresBackend(pool);
  } else if (backendType === 'redis') {
    const redisConfig = (config as RedisJobQueueConfig).redisConfig;
    // RedisBackend constructor will throw if ioredis is not installed
    backend = new RedisBackend(redisConfig);
  } else {
    throw new Error(`Unknown backend: ${backendType}`);
  }

  // Return the job queue API
  return {
    // Job queue operations
    addJob: withLogContext(
      (job: JobOptions<PayloadMap, any>) =>
        backend.addJob<PayloadMap, any>(job),
      config.verbose ?? false,
    ),
    getJob: withLogContext(
      (id: number) => backend.getJob<PayloadMap, any>(id),
      config.verbose ?? false,
    ),
    getJobsByStatus: withLogContext(
      (status: string, limit?: number, offset?: number) =>
        backend.getJobsByStatus<PayloadMap, any>(status, limit, offset),
      config.verbose ?? false,
    ),
    getAllJobs: withLogContext(
      (limit?: number, offset?: number) =>
        backend.getAllJobs<PayloadMap, any>(limit, offset),
      config.verbose ?? false,
    ),
    getJobs: withLogContext(
      (
        filters?: {
          jobType?: string;
          priority?: number;
          runAt?:
            | Date
            | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
          tags?: { values: string[]; mode?: import('./types.js').TagQueryMode };
        },
        limit?: number,
        offset?: number,
      ) => backend.getJobs<PayloadMap, any>(filters, limit, offset),
      config.verbose ?? false,
    ),
    retryJob: (jobId: number) => backend.retryJob(jobId),
    cleanupOldJobs: (daysToKeep?: number) => backend.cleanupOldJobs(daysToKeep),
    cancelJob: withLogContext(
      (jobId: number) => backend.cancelJob(jobId),
      config.verbose ?? false,
    ),
    editJob: withLogContext(
      <T extends JobType<PayloadMap>>(
        jobId: number,
        updates: import('./types.js').EditJobOptions<PayloadMap, T>,
      ) => backend.editJob(jobId, updates as any),
      config.verbose ?? false,
    ),
    editAllPendingJobs: withLogContext(
      <T extends JobType<PayloadMap>>(
        filters:
          | {
              jobType?: string;
              priority?: number;
              runAt?:
                | Date
                | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
              tags?: {
                values: string[];
                mode?: import('./types.js').TagQueryMode;
              };
            }
          | undefined,
        updates: import('./types.js').EditJobOptions<PayloadMap, T>,
      ) => backend.editAllPendingJobs(filters, updates as any),
      config.verbose ?? false,
    ),
    cancelAllUpcomingJobs: withLogContext(
      (filters?: {
        jobType?: string;
        priority?: number;
        runAt?:
          | Date
          | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
        tags?: { values: string[]; mode?: import('./types.js').TagQueryMode };
      }) => backend.cancelAllUpcomingJobs(filters),
      config.verbose ?? false,
    ),
    reclaimStuckJobs: withLogContext(
      (maxProcessingTimeMinutes?: number) =>
        backend.reclaimStuckJobs(maxProcessingTimeMinutes),
      config.verbose ?? false,
    ),
    getJobsByTags: withLogContext(
      (tags: string[], mode = 'all', limit?: number, offset?: number) =>
        backend.getJobsByTags<PayloadMap, any>(tags, mode, limit, offset),
      config.verbose ?? false,
    ),

    // Job processing
    createProcessor: (
      handlers: JobHandlers<PayloadMap>,
      options?: ProcessorOptions,
    ) => createProcessor<PayloadMap>(backend, handlers, options),
    // Advanced access
    getPool: () => {
      if (backendType !== 'postgres') {
        throw new Error(
          'getPool() is only available with the PostgreSQL backend.',
        );
      }
      return (backend as PostgresBackend).getPool();
    },
    getRedisClient: () => {
      if (backendType !== 'redis') {
        throw new Error(
          'getRedisClient() is only available with the Redis backend.',
        );
      }
      return (backend as RedisBackend).getClient();
    },
    // Job events
    getJobEvents: withLogContext(
      (jobId: number) => backend.getJobEvents(jobId),
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
export { QueueBackend } from './backend.js';
export { PostgresBackend } from './backends/postgres.js';
export {
  validateHandlerSerializable,
  testHandlerSerialization,
} from './handler-validation.js';
