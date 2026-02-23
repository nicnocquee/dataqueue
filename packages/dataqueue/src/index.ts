import { createProcessor } from './processor.js';
import { createSupervisor } from './supervisor.js';
import {
  JobQueueConfig,
  JobQueue,
  JobOptions,
  ProcessorOptions,
  SupervisorOptions,
  JobHandlers,
  JobType,
  PostgresJobQueueConfig,
  RedisJobQueueConfig,
  CronScheduleOptions,
  CronScheduleStatus,
  EditCronScheduleOptions,
} from './types.js';
import { QueueBackend, CronScheduleInput } from './backend.js';
import { setLogContext } from './log-context.js';
import { createPool } from './db-util.js';
import { PostgresBackend } from './backends/postgres.js';
import { RedisBackend } from './backends/redis.js';
import { getNextCronOccurrence, validateCronExpression } from './cron.js';

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
    backend = new RedisBackend(redisConfig);
  } else {
    throw new Error(`Unknown backend: ${backendType}`);
  }

  /**
   * Enqueue due cron jobs. Shared by the public API and the processor hook.
   */
  const enqueueDueCronJobsImpl = async (): Promise<number> => {
    const dueSchedules = await backend.getDueCronSchedules();
    let count = 0;

    for (const schedule of dueSchedules) {
      // Overlap check: skip if allowOverlap is false and last job is still active
      if (!schedule.allowOverlap && schedule.lastJobId !== null) {
        const lastJob = await backend.getJob(schedule.lastJobId);
        if (
          lastJob &&
          (lastJob.status === 'pending' ||
            lastJob.status === 'processing' ||
            lastJob.status === 'waiting')
        ) {
          // Still active — advance nextRunAt but don't enqueue
          const nextRunAt = getNextCronOccurrence(
            schedule.cronExpression,
            schedule.timezone,
          );
          await backend.updateCronScheduleAfterEnqueue(
            schedule.id,
            new Date(),
            schedule.lastJobId,
            nextRunAt,
          );
          continue;
        }
      }

      // Enqueue a new job instance
      const jobId = await backend.addJob<any, any>({
        jobType: schedule.jobType,
        payload: schedule.payload,
        maxAttempts: schedule.maxAttempts,
        priority: schedule.priority,
        timeoutMs: schedule.timeoutMs ?? undefined,
        forceKillOnTimeout: schedule.forceKillOnTimeout,
        tags: schedule.tags,
        retryDelay: schedule.retryDelay ?? undefined,
        retryBackoff: schedule.retryBackoff ?? undefined,
        retryDelayMax: schedule.retryDelayMax ?? undefined,
      });

      // Advance to next occurrence
      const nextRunAt = getNextCronOccurrence(
        schedule.cronExpression,
        schedule.timezone,
      );
      await backend.updateCronScheduleAfterEnqueue(
        schedule.id,
        new Date(),
        jobId,
        nextRunAt,
      );
      count++;
    }

    return count;
  };

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
    cleanupOldJobs: (daysToKeep?: number, batchSize?: number) =>
      backend.cleanupOldJobs(daysToKeep, batchSize),
    cleanupOldJobEvents: (daysToKeep?: number, batchSize?: number) =>
      backend.cleanupOldJobEvents(daysToKeep, batchSize),
    cancelJob: withLogContext(
      (jobId: number) => backend.cancelJob(jobId),
      config.verbose ?? false,
    ),
    editJob: withLogContext(
      <T extends JobType<PayloadMap>>(
        jobId: number,
        updates: import('./types.js').EditJobOptions<PayloadMap, T>,
      ) => backend.editJob(jobId, updates as import('./backend.js').JobUpdates),
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
      ) =>
        backend.editAllPendingJobs(
          filters,
          updates as import('./backend.js').JobUpdates,
        ),
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

    // Job processing — automatically enqueues due cron jobs before each batch
    createProcessor: (
      handlers: JobHandlers<PayloadMap>,
      options?: ProcessorOptions,
    ) =>
      createProcessor<PayloadMap>(backend, handlers, options, async () => {
        await enqueueDueCronJobsImpl();
      }),

    // Background supervisor — automated maintenance
    createSupervisor: (options?: SupervisorOptions) =>
      createSupervisor(backend, options),

    // Job events
    getJobEvents: withLogContext(
      (jobId: number) => backend.getJobEvents(jobId),
      config.verbose ?? false,
    ),

    // Wait / Token support (works with all backends)
    createToken: withLogContext(
      (options?: import('./types.js').CreateTokenOptions) =>
        backend.createWaitpoint(null, options),
      config.verbose ?? false,
    ),
    completeToken: withLogContext(
      (tokenId: string, data?: any) => backend.completeWaitpoint(tokenId, data),
      config.verbose ?? false,
    ),
    getToken: withLogContext(
      (tokenId: string) => backend.getWaitpoint(tokenId),
      config.verbose ?? false,
    ),
    expireTimedOutTokens: withLogContext(
      () => backend.expireTimedOutWaitpoints(),
      config.verbose ?? false,
    ),

    // Cron schedule operations
    addCronJob: withLogContext(
      <T extends JobType<PayloadMap>>(
        options: CronScheduleOptions<PayloadMap, T>,
      ) => {
        if (!validateCronExpression(options.cronExpression)) {
          return Promise.reject(
            new Error(`Invalid cron expression: "${options.cronExpression}"`),
          );
        }
        const nextRunAt = getNextCronOccurrence(
          options.cronExpression,
          options.timezone ?? 'UTC',
        );
        const input: CronScheduleInput = {
          scheduleName: options.scheduleName,
          cronExpression: options.cronExpression,
          jobType: options.jobType as string,
          payload: options.payload,
          maxAttempts: options.maxAttempts ?? 3,
          priority: options.priority ?? 0,
          timeoutMs: options.timeoutMs ?? null,
          forceKillOnTimeout: options.forceKillOnTimeout ?? false,
          tags: options.tags,
          timezone: options.timezone ?? 'UTC',
          allowOverlap: options.allowOverlap ?? false,
          nextRunAt,
          retryDelay: options.retryDelay ?? null,
          retryBackoff: options.retryBackoff ?? null,
          retryDelayMax: options.retryDelayMax ?? null,
        };
        return backend.addCronSchedule(input);
      },
      config.verbose ?? false,
    ),
    getCronJob: withLogContext(
      (id: number) => backend.getCronSchedule(id),
      config.verbose ?? false,
    ),
    getCronJobByName: withLogContext(
      (name: string) => backend.getCronScheduleByName(name),
      config.verbose ?? false,
    ),
    listCronJobs: withLogContext(
      (status?: CronScheduleStatus) => backend.listCronSchedules(status),
      config.verbose ?? false,
    ),
    removeCronJob: withLogContext(
      (id: number) => backend.removeCronSchedule(id),
      config.verbose ?? false,
    ),
    pauseCronJob: withLogContext(
      (id: number) => backend.pauseCronSchedule(id),
      config.verbose ?? false,
    ),
    resumeCronJob: withLogContext(
      (id: number) => backend.resumeCronSchedule(id),
      config.verbose ?? false,
    ),
    editCronJob: withLogContext(
      async (id: number, updates: EditCronScheduleOptions) => {
        if (
          updates.cronExpression !== undefined &&
          !validateCronExpression(updates.cronExpression)
        ) {
          throw new Error(
            `Invalid cron expression: "${updates.cronExpression}"`,
          );
        }
        let nextRunAt: Date | null | undefined;
        if (
          updates.cronExpression !== undefined ||
          updates.timezone !== undefined
        ) {
          const existing = await backend.getCronSchedule(id);
          const expr = updates.cronExpression ?? existing?.cronExpression ?? '';
          const tz = updates.timezone ?? existing?.timezone ?? 'UTC';
          nextRunAt = getNextCronOccurrence(expr, tz);
        }
        await backend.editCronSchedule(id, updates, nextRunAt);
      },
      config.verbose ?? false,
    ),
    enqueueDueCronJobs: withLogContext(
      () => enqueueDueCronJobsImpl(),
      config.verbose ?? false,
    ),

    // Advanced access
    getPool: () => {
      if (!(backend instanceof PostgresBackend)) {
        throw new Error(
          'getPool() is only available with the PostgreSQL backend.',
        );
      }
      return backend.getPool();
    },
    getRedisClient: () => {
      if (backendType !== 'redis') {
        throw new Error(
          'getRedisClient() is only available with the Redis backend.',
        );
      }
      return (backend as RedisBackend).getClient();
    },
  };
};

const withLogContext =
  <T>(fn: (...args: any[]) => T, verbose: boolean) =>
  (...args: Parameters<typeof fn>): ReturnType<typeof fn> => {
    setLogContext(verbose);
    return fn(...args);
  };

export * from './types.js';
export { QueueBackend, CronScheduleInput } from './backend.js';
export { PostgresBackend } from './backends/postgres.js';
export {
  validateHandlerSerializable,
  testHandlerSerialization,
} from './handler-validation.js';
export { getNextCronOccurrence, validateCronExpression } from './cron.js';
