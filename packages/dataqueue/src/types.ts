// Utility type for job type keys
export type JobType<PayloadMap> = keyof PayloadMap & string;

/**
 * Abstract database client interface for transactional job creation.
 * Compatible with `pg.Pool`, `pg.PoolClient`, `pg.Client`, or any object
 * that exposes a `.query()` method matching the `pg` signature.
 */
export interface DatabaseClient {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Options for `addJob()` beyond the job itself.
 * Use `db` to insert the job within an existing database transaction.
 */
export interface AddJobOptions {
  /**
   * An external database client (e.g., a `pg.PoolClient` inside a transaction).
   * When provided, the INSERT runs on this client instead of the internal pool,
   * so the job is part of the caller's transaction.
   *
   * **PostgreSQL only.** Throws if used with the Redis backend.
   */
  db?: DatabaseClient;
}

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
   * If true, the job will be forcefully terminated (using Worker Threads) when timeout is reached.
   * If false (default), the job will only receive an AbortSignal and must handle the abort gracefully.
   *
   * **⚠️ RUNTIME REQUIREMENTS**: This option requires **Node.js** and uses the `worker_threads` module.
   * It will **not work** in Bun or other runtimes that don't support Node.js worker threads.
   *
   * **IMPORTANT**: When `forceKillOnTimeout` is true, the handler must be serializable. This means:
   * - The handler should be a standalone function (not a closure over external variables)
   * - It should not capture variables from outer scopes that reference external dependencies
   * - It should not use 'this' context unless it's a bound method
   * - All dependencies must be importable in the worker thread context
   *
   * **Examples of serializable handlers:**
   * ```ts
   * // ✅ Good - standalone function
   * const handler = async (payload, signal) => {
   *   await doSomething(payload);
   * };
   *
   * // ✅ Good - function that imports dependencies
   * const handler = async (payload, signal) => {
   *   const { api } = await import('./api');
   *   await api.call(payload);
   * };
   *
   * // ❌ Bad - closure over external variable
   * const db = getDatabase();
   * const handler = async (payload, signal) => {
   *   await db.query(payload); // 'db' is captured from closure
   * };
   *
   * // ❌ Bad - uses 'this' context
   * class MyHandler {
   *   async handle(payload, signal) {
   *     await this.doSomething(payload); // 'this' won't work
   *   }
   * }
   * ```
   *
   * If your handler doesn't meet these requirements, use `forceKillOnTimeout: false` (default)
   * and ensure your handler checks `signal.aborted` to exit gracefully.
   *
   * Note: forceKillOnTimeout requires timeoutMs to be set.
   */
  forceKillOnTimeout?: boolean;
  /**
   * Tags for this job. Used for grouping, searching, or batch operations.
   */
  tags?: string[];
  /**
   * Optional idempotency key. When provided, ensures that only one job exists for a given key.
   * If a job with the same idempotency key already exists, `addJob` returns the existing job's ID
   * instead of creating a duplicate.
   *
   * Useful for preventing duplicate jobs caused by retries, double-clicks, webhook replays,
   * or serverless function re-invocations.
   *
   * The key is unique across the entire `job_queue` table regardless of job status.
   * Once a key exists, it cannot be reused until the job is cleaned up (via `cleanupOldJobs`).
   */
  idempotencyKey?: string;
}

/**
 * Options for editing a pending job.
 * All fields are optional and only provided fields will be updated.
 * Note: jobType cannot be changed.
 * timeoutMs and tags can be set to null to clear them.
 */
export type EditJobOptions<PayloadMap, T extends JobType<PayloadMap>> = Partial<
  Omit<JobOptions<PayloadMap, T>, 'jobType'>
> & {
  timeoutMs?: number | null;
  tags?: string[] | null;
};

export enum JobEventType {
  Added = 'added',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Retried = 'retried',
  Edited = 'edited',
  Prolonged = 'prolonged',
  Waiting = 'waiting',
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
  | 'cancelled'
  | 'waiting';

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
   * If true, the job will be forcefully terminated (using Worker Threads) when timeout is reached.
   * If false (default), the job will only receive an AbortSignal and must handle the abort gracefully.
   */
  forceKillOnTimeout?: boolean | null;
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
  /**
   * The idempotency key for this job, if one was provided when the job was created.
   */
  idempotencyKey?: string | null;
  /**
   * The time the job is waiting until (for time-based waits).
   */
  waitUntil?: Date | null;
  /**
   * The waitpoint token ID the job is waiting for (for token-based waits).
   */
  waitTokenId?: string | null;
  /**
   * Step data for the job. Stores completed step results for replay on re-invocation.
   */
  stepData?: Record<string, any>;
  /**
   * Progress percentage for the job (0-100), or null if no progress has been reported.
   * Updated by the handler via `ctx.setProgress(percent)`.
   */
  progress?: number | null;
}

/**
 * Callback registered via `onTimeout`. Invoked when the timeout fires, before the AbortSignal is triggered.
 * Return a number (ms) to extend the timeout, or return nothing to let the timeout proceed.
 */
export type OnTimeoutCallback = () => number | void | undefined;

/**
 * Context object passed to job handlers as the third argument.
 * Provides mechanisms to extend the job's timeout while it's running,
 * as well as step tracking and wait capabilities.
 */
export interface JobContext {
  /**
   * Proactively reset the timeout deadline.
   * - If `ms` is provided, sets the deadline to `ms` milliseconds from now.
   * - If omitted, resets the deadline to the original `timeoutMs` from now (heartbeat-style).
   * - No-op if the job has no timeout set or if `forceKillOnTimeout` is true.
   */
  prolong: (ms?: number) => void;

  /**
   * Register a callback that is invoked when the timeout fires, **before** the AbortSignal is triggered.
   * - If the callback returns a number > 0, the timeout is reset to that many ms from now.
   * - If the callback returns `undefined`, `null`, `0`, or a negative number, the timeout proceeds normally.
   * - The callback may be invoked multiple times if the job keeps extending.
   * - Only one callback can be registered; subsequent calls replace the previous one.
   * - No-op if the job has no timeout set or if `forceKillOnTimeout` is true.
   */
  onTimeout: (callback: OnTimeoutCallback) => void;

  /**
   * Execute a named step with memoization. If the step was already completed
   * in a previous invocation (e.g., before a wait), the cached result is returned
   * without re-executing the function.
   *
   * Step names must be unique within a handler and stable across re-invocations.
   *
   * @param stepName - A unique identifier for this step.
   * @param fn - The function to execute. Its return value is cached.
   * @returns The result of the step (from cache or fresh execution).
   */
  run: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>;

  /**
   * Wait for a specified duration before continuing execution.
   * The job will be paused and resumed after the duration elapses.
   *
   * When this is called, the handler throws a WaitSignal internally.
   * The job is set to 'waiting' status and will be re-invoked after the
   * specified duration. All steps completed via `ctx.run()` before this
   * call will be replayed from cache on re-invocation.
   *
   * @param duration - The duration to wait (e.g., `{ hours: 1 }`, `{ days: 7 }`).
   */
  waitFor: (duration: WaitDuration) => Promise<void>;

  /**
   * Wait until a specific date/time before continuing execution.
   * The job will be paused and resumed at (or after) the specified date.
   *
   * @param date - The date to wait until.
   */
  waitUntil: (date: Date) => Promise<void>;

  /**
   * Create a waitpoint token. The token can be completed externally
   * (by calling `jobQueue.completeToken()`) to resume a waiting job.
   *
   * Tokens can be created inside handlers or outside (via `jobQueue.createToken()`).
   *
   * @param options - Optional token configuration (timeout, tags).
   * @returns A token object with `id` that can be passed to `waitForToken()`.
   */
  createToken: (options?: CreateTokenOptions) => Promise<WaitToken>;

  /**
   * Wait for a waitpoint token to be completed by an external signal.
   * The job will be paused until `jobQueue.completeToken(tokenId, data)` is called
   * or the token times out.
   *
   * @param tokenId - The ID of the token to wait for.
   * @returns A result object indicating success or timeout.
   */
  waitForToken: <T = any>(tokenId: string) => Promise<WaitTokenResult<T>>;

  /**
   * Report progress for this job (0-100).
   * The value is persisted to the database and can be read by clients
   * via `getJob()` or the React SDK's `useJob()` hook.
   *
   * @param percent - Progress percentage (0-100). Values are rounded to the nearest integer.
   * @throws If percent is outside the 0-100 range.
   */
  setProgress: (percent: number) => Promise<void>;
}

/**
 * Duration specification for `ctx.waitFor()`.
 * At least one field must be provided. Fields are additive.
 */
export interface WaitDuration {
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
  weeks?: number;
  months?: number;
  years?: number;
}

/**
 * Options for creating a waitpoint token.
 */
export interface CreateTokenOptions {
  /**
   * Maximum time to wait for the token to be completed.
   * Accepts a duration string like '10m', '1h', '24h', '7d'.
   * If not provided, the token has no timeout.
   */
  timeout?: string;
  /**
   * Tags to attach to the token for filtering.
   */
  tags?: string[];
}

/**
 * A waitpoint token returned by `ctx.createToken()`.
 */
export interface WaitToken {
  /** The unique token ID. */
  id: string;
}

/**
 * Result of `ctx.waitForToken()`.
 */
export type WaitTokenResult<T = any> =
  | { ok: true; output: T }
  | { ok: false; error: string };

/**
 * Internal signal thrown by wait methods to pause handler execution.
 * This is not a real error -- the processor catches it and transitions the job to 'waiting' status.
 */
export class WaitSignal extends Error {
  readonly isWaitSignal = true;

  constructor(
    public readonly type: 'duration' | 'date' | 'token',
    public readonly waitUntil: Date | undefined,
    public readonly tokenId: string | undefined,
    public readonly stepData: Record<string, any>,
  ) {
    super('WaitSignal');
    this.name = 'WaitSignal';
  }
}

/**
 * Status of a waitpoint token.
 */
export type WaitpointStatus = 'waiting' | 'completed' | 'timed_out';

/**
 * A waitpoint record from the database.
 */
export interface WaitpointRecord {
  id: string;
  jobId: number | null;
  status: WaitpointStatus;
  output: any;
  timeoutAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  tags: string[] | null;
}

export type JobHandler<PayloadMap, T extends keyof PayloadMap> = (
  payload: PayloadMap[T],
  signal: AbortSignal,
  ctx: JobContext,
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
   * Does not wait for in-flight jobs to complete.
   */
  stop: () => void;
  /**
   * Stop the job processor and wait for all in-flight jobs to complete.
   * Useful for graceful shutdown (e.g., SIGTERM handling).
   * No new batches will be started after calling this method.
   *
   * @param timeoutMs - Maximum time to wait for in-flight jobs (default: 30000ms).
   *   If jobs don't complete within this time, the promise resolves anyway.
   */
  stopAndDrain: (timeoutMs?: number) => Promise<void>;
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

export interface SupervisorOptions {
  /**
   * How often the maintenance loop runs, in milliseconds.
   * @default 60000 (1 minute)
   */
  intervalMs?: number;
  /**
   * Reclaim jobs stuck in `processing` longer than this many minutes.
   * @default 10
   */
  stuckJobsTimeoutMinutes?: number;
  /**
   * Auto-delete completed jobs older than this many days. Set to 0 to disable.
   * @default 30
   */
  cleanupJobsDaysToKeep?: number;
  /**
   * Auto-delete job events older than this many days. Set to 0 to disable.
   * @default 30
   */
  cleanupEventsDaysToKeep?: number;
  /**
   * Batch size for cleanup deletions.
   * @default 1000
   */
  cleanupBatchSize?: number;
  /**
   * Whether to reclaim stuck jobs each cycle.
   * @default true
   */
  reclaimStuckJobs?: boolean;
  /**
   * Whether to expire timed-out waitpoint tokens each cycle.
   * @default true
   */
  expireTimedOutTokens?: boolean;
  /**
   * Called when a maintenance task throws. One failure does not block other tasks.
   * @default console.error
   */
  onError?: (error: Error) => void;
  /** Enable verbose logging. */
  verbose?: boolean;
}

export interface SupervisorRunResult {
  /** Number of stuck jobs reclaimed back to pending. */
  reclaimedJobs: number;
  /** Number of old completed jobs deleted. */
  cleanedUpJobs: number;
  /** Number of old job events deleted. */
  cleanedUpEvents: number;
  /** Number of timed-out waitpoint tokens expired. */
  expiredTokens: number;
}

export interface Supervisor {
  /**
   * Run all maintenance tasks once and return the results.
   * Ideal for serverless or cron-triggered invocations.
   */
  start: () => Promise<SupervisorRunResult>;
  /**
   * Start the maintenance loop in the background.
   * Runs every `intervalMs` milliseconds (default: 60 000).
   * Call `stop()` or `stopAndDrain()` to halt the loop.
   */
  startInBackground: () => void;
  /**
   * Stop the background maintenance loop immediately.
   * Does not wait for an in-flight maintenance run to complete.
   */
  stop: () => void;
  /**
   * Stop the background loop and wait for the current maintenance run
   * (if any) to finish before resolving.
   *
   * @param timeoutMs - Maximum time to wait (default: 30 000 ms).
   *   If the run does not finish within this time the promise resolves anyway.
   */
  stopAndDrain: (timeoutMs?: number) => Promise<void>;
  /** Whether the background maintenance loop is currently running. */
  isRunning: () => boolean;
}

export interface DatabaseSSLConfig {
  /**
   * CA certificate as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  ca?: string;
  /**
   * Client certificate as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  cert?: string;
  /**
   * Client private key as PEM string or file path. If the value starts with 'file://', it will be loaded from file, otherwise treated as PEM string.
   */
  key?: string;
  /**
   * Whether to reject unauthorized certificates (default: true)
   */
  rejectUnauthorized?: boolean;
}

/**
 * Configuration for PostgreSQL backend (default).
 * Backward-compatible: omitting `backend` defaults to 'postgres'.
 *
 * Provide either `databaseConfig` (the library creates a pool) or `pool`
 * (bring your own `pg.Pool`). At least one must be set.
 */
export interface PostgresJobQueueConfig {
  backend?: 'postgres';
  databaseConfig?: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: DatabaseSSLConfig;
    /**
     * Maximum number of clients in the pool (default: 10).
     * Increase when running multiple processors in the same process.
     */
    max?: number;
    /**
     * Minimum number of idle clients in the pool (default: 0).
     */
    min?: number;
    /**
     * Milliseconds a client must sit idle before being closed (default: 10000).
     */
    idleTimeoutMillis?: number;
    /**
     * Milliseconds to wait for a connection before throwing (default: 0, no timeout).
     */
    connectionTimeoutMillis?: number;
  };
  /**
   * Bring your own `pg.Pool` instance. When provided, `databaseConfig` is
   * ignored and the library will not close the pool on shutdown.
   */
  pool?: import('pg').Pool;
  verbose?: boolean;
}

/**
 * TLS configuration for the Redis connection.
 */
export interface RedisTLSConfig {
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
}

/**
 * Configuration for Redis backend.
 *
 * Provide either `redisConfig` (the library creates an ioredis client) or
 * `client` (bring your own ioredis instance). At least one must be set.
 */
export interface RedisJobQueueConfig {
  backend: 'redis';
  redisConfig?: {
    /** Redis URL (e.g. redis://localhost:6379) */
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    /** Redis database number (default: 0) */
    db?: number;
    tls?: RedisTLSConfig;
    /**
     * Key prefix for all Redis keys (default: 'dq:').
     * Useful to namespace multiple queues in the same Redis instance.
     */
    keyPrefix?: string;
  };
  /**
   * Bring your own ioredis client instance. When provided, `redisConfig` is
   * ignored and the library will not close the client on shutdown.
   * Use `keyPrefix` to set the key namespace (default: 'dq:').
   */
  client?: unknown;
  /**
   * Key prefix when using an external `client`. Ignored when `redisConfig` is used
   * (set `redisConfig.keyPrefix` instead). Default: 'dq:'.
   */
  keyPrefix?: string;
  verbose?: boolean;
}

/**
 * Job queue configuration — discriminated union.
 * If `backend` is omitted, PostgreSQL is used.
 */
export type JobQueueConfig = PostgresJobQueueConfig | RedisJobQueueConfig;

/** @deprecated Use JobQueueConfig instead. Alias kept for backward compat. */
export type JobQueueConfigLegacy = PostgresJobQueueConfig;

export type TagQueryMode = 'exact' | 'all' | 'any' | 'none';

// ── Cron schedule types ──────────────────────────────────────────────

/**
 * Status of a cron schedule.
 */
export type CronScheduleStatus = 'active' | 'paused';

/**
 * Options for creating a recurring cron schedule.
 * Each schedule defines a recurring job that is automatically enqueued
 * when its cron expression matches.
 */
export interface CronScheduleOptions<
  PayloadMap,
  T extends JobType<PayloadMap>,
> {
  /** Unique human-readable name for the schedule. */
  scheduleName: string;
  /** Standard cron expression (5 fields, e.g. "0 * * * *"). */
  cronExpression: string;
  /** Job type from the PayloadMap. */
  jobType: T;
  /** Payload for each job instance. */
  payload: PayloadMap[T];
  /** Maximum retry attempts for each job instance (default: 3). */
  maxAttempts?: number;
  /** Priority for each job instance (default: 0). */
  priority?: number;
  /** Timeout in milliseconds for each job instance. */
  timeoutMs?: number;
  /** Whether to force-kill the job on timeout (default: false). */
  forceKillOnTimeout?: boolean;
  /** Tags for each job instance. */
  tags?: string[];
  /** IANA timezone string for cron evaluation (default: "UTC"). */
  timezone?: string;
  /**
   * Whether to allow overlapping job instances (default: false).
   * When false, a new job will not be enqueued if the previous instance
   * is still pending, processing, or waiting.
   */
  allowOverlap?: boolean;
}

/**
 * A persisted cron schedule record.
 */
export interface CronScheduleRecord {
  id: number;
  scheduleName: string;
  cronExpression: string;
  jobType: string;
  payload: any;
  maxAttempts: number;
  priority: number;
  timeoutMs: number | null;
  forceKillOnTimeout: boolean;
  tags: string[] | undefined;
  timezone: string;
  allowOverlap: boolean;
  status: CronScheduleStatus;
  lastEnqueuedAt: Date | null;
  lastJobId: number | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for editing an existing cron schedule.
 * All fields are optional; only provided fields are updated.
 */
export interface EditCronScheduleOptions {
  cronExpression?: string;
  payload?: any;
  maxAttempts?: number;
  priority?: number;
  timeoutMs?: number | null;
  forceKillOnTimeout?: boolean;
  tags?: string[] | null;
  timezone?: string;
  allowOverlap?: boolean;
}

export interface JobQueue<PayloadMap> {
  /**
   * Add a job to the job queue.
   *
   * @param job - The job to enqueue.
   * @param options - Optional. Pass `{ db }` with an external database client
   *   to insert the job within an existing transaction (PostgreSQL only).
   */
  addJob: <T extends JobType<PayloadMap>>(
    job: JobOptions<PayloadMap, T>,
    options?: AddJobOptions,
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
   * Get jobs by filters, with pagination support.
   * - Use `cursor` for efficient keyset pagination (recommended for large datasets).
   * - Use `limit` and `offset` for traditional pagination.
   * - Do not combine `cursor` with `offset`.
   */
  getJobs: <T extends JobType<PayloadMap>>(
    filters?: {
      jobType?: string;
      priority?: number;
      runAt?:
        | Date
        | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
      tags?: { values: string[]; mode?: TagQueryMode };
      /** Cursor for keyset pagination. Only return jobs with id < cursor. */
      cursor?: number;
    },
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
   * Deletes in batches for scale safety.
   * @param daysToKeep - Number of days to retain completed jobs (default 30).
   * @param batchSize - Number of rows to delete per batch (default 1000 for PostgreSQL, 200 for Redis).
   */
  cleanupOldJobs: (daysToKeep?: number, batchSize?: number) => Promise<number>;
  /**
   * Cleanup job events that are older than the specified number of days.
   * Deletes in batches for scale safety.
   * @param daysToKeep - Number of days to retain events (default 30).
   * @param batchSize - Number of rows to delete per batch (default 1000).
   */
  cleanupOldJobEvents: (
    daysToKeep?: number,
    batchSize?: number,
  ) => Promise<number>;
  /**
   * Cancel a job given its ID.
   * - This will set the job status to 'cancelled' and clear the locked_at and locked_by.
   */
  cancelJob: (jobId: number) => Promise<void>;
  /**
   * Edit a pending job given its ID.
   * - Only works for jobs with status 'pending'. Silently fails for other statuses.
   * - All fields in EditJobOptions are optional - only provided fields will be updated.
   * - jobType cannot be changed.
   * - Records an 'edited' event with the updated fields in metadata.
   */
  editJob: <T extends JobType<PayloadMap>>(
    jobId: number,
    updates: EditJobOptions<PayloadMap, T>,
  ) => Promise<void>;
  /**
   * Edit all pending jobs that match the filters.
   * - Only works for jobs with status 'pending'. Non-pending jobs are not affected.
   * - All fields in EditJobOptions are optional - only provided fields will be updated.
   * - jobType cannot be changed.
   * - Records an 'edited' event with the updated fields in metadata for each affected job.
   * - Returns the number of jobs that were edited.
   * - The filters are:
   *   - jobType: The job type to edit.
   *   - priority: The priority of the job to edit.
   *   - runAt: The time the job is scheduled to run at (now supports gt/gte/lt/lte/eq).
   *   - tags: An object with 'values' (string[]) and 'mode' (TagQueryMode) for tag-based editing.
   */
  editAllPendingJobs: <T extends JobType<PayloadMap>>(
    filters:
      | {
          jobType?: string;
          priority?: number;
          runAt?:
            | Date
            | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date };
          tags?: { values: string[]; mode?: TagQueryMode };
        }
      | undefined,
    updates: EditJobOptions<PayloadMap, T>,
  ) => Promise<number>;
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
   * Create a background supervisor that automatically reclaims stuck jobs,
   * cleans up old completed jobs/events, and expires timed-out waitpoint
   * tokens on a configurable interval.
   */
  createSupervisor: (options?: SupervisorOptions) => Supervisor;

  /**
   * Get the job events for a job.
   */
  getJobEvents: (jobId: number) => Promise<JobEvent[]>;

  /**
   * Create a waitpoint token.
   * Tokens can be completed externally to resume a waiting job.
   * Can be called outside of handlers (e.g., from an API route).
   *
   * @param options - Optional token configuration (timeout, tags).
   * @returns A token object with `id`.
   */
  createToken: (options?: CreateTokenOptions) => Promise<WaitToken>;

  /**
   * Complete a waitpoint token, resuming the associated waiting job.
   * Can be called from anywhere (API routes, external services, etc.).
   *
   * @param tokenId - The ID of the token to complete.
   * @param data - Optional data to pass to the waiting handler.
   */
  completeToken: (tokenId: string, data?: any) => Promise<void>;

  /**
   * Retrieve a waitpoint token by its ID.
   *
   * @param tokenId - The ID of the token to retrieve.
   * @returns The token record, or null if not found.
   */
  getToken: (tokenId: string) => Promise<WaitpointRecord | null>;

  /**
   * Expire timed-out waitpoint tokens and resume their associated jobs.
   * Call this periodically (e.g., alongside `reclaimStuckJobs`).
   *
   * @returns The number of tokens that were expired.
   */
  expireTimedOutTokens: () => Promise<number>;

  // ── Cron schedule operations ────────────────────────────────────────

  /**
   * Add a recurring cron schedule. The processor automatically enqueues
   * due cron jobs before each batch, so no manual triggering is needed.
   *
   * @returns The ID of the created schedule.
   * @throws If the cron expression is invalid or the schedule name is already taken.
   */
  addCronJob: <T extends JobType<PayloadMap>>(
    options: CronScheduleOptions<PayloadMap, T>,
  ) => Promise<number>;

  /**
   * Get a cron schedule by its ID.
   */
  getCronJob: (id: number) => Promise<CronScheduleRecord | null>;

  /**
   * Get a cron schedule by its unique name.
   */
  getCronJobByName: (name: string) => Promise<CronScheduleRecord | null>;

  /**
   * List all cron schedules, optionally filtered by status.
   */
  listCronJobs: (status?: CronScheduleStatus) => Promise<CronScheduleRecord[]>;

  /**
   * Remove a cron schedule by its ID. Does not cancel any already-enqueued jobs.
   */
  removeCronJob: (id: number) => Promise<void>;

  /**
   * Pause a cron schedule. Paused schedules are skipped by `enqueueDueCronJobs()`.
   */
  pauseCronJob: (id: number) => Promise<void>;

  /**
   * Resume a paused cron schedule.
   */
  resumeCronJob: (id: number) => Promise<void>;

  /**
   * Edit an existing cron schedule. Only provided fields are updated.
   * If `cronExpression` or `timezone` changes, `nextRunAt` is recalculated.
   */
  editCronJob: (id: number, updates: EditCronScheduleOptions) => Promise<void>;

  /**
   * Check all active cron schedules and enqueue jobs for any whose
   * `nextRunAt` has passed. When `allowOverlap` is false (the default),
   * a new job is not enqueued if the previous instance is still
   * pending, processing, or waiting.
   *
   * **Note:** The processor calls this automatically before each batch,
   * so you typically do not need to call it yourself. It is exposed for
   * manual use in tests or one-off scripts.
   *
   * @returns The number of jobs that were enqueued.
   */
  enqueueDueCronJobs: () => Promise<number>;

  // ── Advanced access ───────────────────────────────────────────────────

  /**
   * Get the PostgreSQL database pool.
   * Throws if the backend is not PostgreSQL.
   */
  getPool: () => import('pg').Pool;
  /**
   * Get the Redis client instance (ioredis).
   * Throws if the backend is not Redis.
   */
  getRedisClient: () => unknown;
}
