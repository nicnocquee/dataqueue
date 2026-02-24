import { createRequire } from 'module';
import type { Redis as RedisType } from 'ioredis';
import {
  JobOptions,
  JobRecord,
  FailureReason,
  JobEvent,
  JobEventType,
  TagQueryMode,
  JobType,
  RedisJobQueueConfig,
  CronScheduleRecord,
  CronScheduleStatus,
  EditCronScheduleOptions,
  WaitpointRecord,
  CreateTokenOptions,
  AddJobOptions,
} from '../types.js';
import {
  QueueBackend,
  JobFilters,
  JobUpdates,
  CronScheduleInput,
} from '../backend.js';
import { log } from '../log-context.js';

const MAX_TIMEOUT_MS = 365 * 24 * 60 * 60 * 1000;

/** Parse a timeout string like '10m', '1h', '24h', '7d' into milliseconds. */
function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid timeout format: "${timeout}". Expected format like "10m", "1h", "24h", "7d".`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  let ms: number;
  switch (unit) {
    case 's':
      ms = value * 1000;
      break;
    case 'm':
      ms = value * 60 * 1000;
      break;
    case 'h':
      ms = value * 60 * 60 * 1000;
      break;
    case 'd':
      ms = value * 24 * 60 * 60 * 1000;
      break;
    default:
      throw new Error(`Unknown timeout unit: "${unit}"`);
  }
  if (!Number.isFinite(ms) || ms > MAX_TIMEOUT_MS) {
    throw new Error(
      `Timeout value "${timeout}" is too large. Maximum allowed is 365 days.`,
    );
  }
  return ms;
}
import {
  ADD_JOB_SCRIPT,
  ADD_JOBS_SCRIPT,
  GET_NEXT_BATCH_SCRIPT,
  COMPLETE_JOB_SCRIPT,
  FAIL_JOB_SCRIPT,
  RETRY_JOB_SCRIPT,
  CANCEL_JOB_SCRIPT,
  PROLONG_JOB_SCRIPT,
  RECLAIM_STUCK_JOBS_SCRIPT,
  CLEANUP_OLD_JOBS_BATCH_SCRIPT,
  WAIT_JOB_SCRIPT,
  COMPLETE_WAITPOINT_SCRIPT,
  EXPIRE_TIMED_OUT_WAITPOINTS_SCRIPT,
} from './redis-scripts.js';
import { randomUUID } from 'crypto';

/** Helper: convert a Redis hash flat array [k,v,k,v,...] to a JS object */
function hashToObject(arr: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

/** Deserialise a Redis hash object into a JobRecord */
function deserializeJob<PayloadMap, T extends JobType<PayloadMap>>(
  h: Record<string, string>,
): JobRecord<PayloadMap, T> {
  const nullish = (v: string | undefined) =>
    v === undefined || v === 'null' || v === '' ? null : v;

  const numOrNull = (v: string | undefined): number | null => {
    const n = nullish(v);
    return n === null ? null : Number(n);
  };
  const dateOrNull = (v: string | undefined): Date | null => {
    const n = numOrNull(v);
    return n === null ? null : new Date(n);
  };

  let errorHistory: { message: string; timestamp: string }[] = [];
  try {
    const raw = h.errorHistory;
    if (raw && raw !== '[]') {
      errorHistory = JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  let tags: string[] | undefined;
  try {
    const raw = h.tags;
    if (raw && raw !== 'null') {
      tags = JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  let payload: any;
  try {
    payload = JSON.parse(h.payload);
  } catch {
    payload = h.payload;
  }

  return {
    id: Number(h.id),
    jobType: h.jobType as T,
    payload,
    status: h.status as any,
    createdAt: new Date(Number(h.createdAt)),
    updatedAt: new Date(Number(h.updatedAt)),
    lockedAt: dateOrNull(h.lockedAt),
    lockedBy: nullish(h.lockedBy) as string | null,
    attempts: Number(h.attempts),
    maxAttempts: Number(h.maxAttempts),
    nextAttemptAt: dateOrNull(h.nextAttemptAt),
    priority: Number(h.priority),
    runAt: new Date(Number(h.runAt)),
    pendingReason: nullish(h.pendingReason) as string | null | undefined,
    errorHistory,
    timeoutMs: numOrNull(h.timeoutMs),
    forceKillOnTimeout:
      h.forceKillOnTimeout === 'true' || h.forceKillOnTimeout === '1'
        ? true
        : h.forceKillOnTimeout === 'false' || h.forceKillOnTimeout === '0'
          ? false
          : null,
    failureReason: (nullish(h.failureReason) as FailureReason | null) ?? null,
    completedAt: dateOrNull(h.completedAt),
    startedAt: dateOrNull(h.startedAt),
    lastRetriedAt: dateOrNull(h.lastRetriedAt),
    lastFailedAt: dateOrNull(h.lastFailedAt),
    lastCancelledAt: dateOrNull(h.lastCancelledAt),
    tags,
    idempotencyKey: nullish(h.idempotencyKey) as string | null | undefined,
    progress: numOrNull(h.progress),
    waitUntil: dateOrNull(h.waitUntil),
    waitTokenId: nullish(h.waitTokenId) as string | null | undefined,
    stepData: parseStepData(h.stepData),
    retryDelay: numOrNull(h.retryDelay),
    retryBackoff:
      h.retryBackoff === 'true'
        ? true
        : h.retryBackoff === 'false'
          ? false
          : null,
    retryDelayMax: numOrNull(h.retryDelayMax),
    groupId: nullish(h.groupId) as string | null | undefined,
    groupTier: nullish(h.groupTier) as string | null | undefined,
    output: parseJsonField(h.output),
  };
}

/** Parse a JSON field from a Redis hash, returning null for missing/null values. */
function parseJsonField(raw: string | undefined): unknown {
  if (!raw || raw === 'null') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Parse step data from a Redis hash field. */
function parseStepData(
  raw: string | undefined,
): Record<string, any> | undefined {
  if (!raw || raw === 'null') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export class RedisBackend implements QueueBackend {
  private client: RedisType;
  private prefix: string;

  /**
   * Create a RedisBackend.
   *
   * @param configOrClient - Either `redisConfig` from the config file (the
   *   library creates a new ioredis client) or an existing ioredis client
   *   instance (bring your own).
   * @param keyPrefix - Key prefix, only used when `configOrClient` is an
   *   external client. Ignored when `redisConfig` is passed (uses
   *   `redisConfig.keyPrefix` instead). Default: `'dq:'`.
   */
  constructor(
    configOrClient: RedisJobQueueConfig['redisConfig'] | RedisType,
    keyPrefix?: string,
  ) {
    if (configOrClient && typeof (configOrClient as any).eval === 'function') {
      this.client = configOrClient as RedisType;
      this.prefix = keyPrefix ?? 'dq:';
      return;
    }

    const redisConfig = configOrClient as NonNullable<
      RedisJobQueueConfig['redisConfig']
    >;

    let IORedis: any;
    try {
      const _require = createRequire(import.meta.url);
      IORedis = _require('ioredis');
    } catch {
      throw new Error(
        'Redis backend requires the "ioredis" package. Install it with: npm install ioredis',
      );
    }

    this.prefix = redisConfig.keyPrefix ?? 'dq:';

    if (redisConfig.url) {
      this.client = new IORedis(redisConfig.url, {
        ...(redisConfig.tls ? { tls: redisConfig.tls } : {}),
        ...(redisConfig.db !== undefined ? { db: redisConfig.db } : {}),
      });
    } else {
      this.client = new IORedis({
        host: redisConfig.host ?? '127.0.0.1',
        port: redisConfig.port ?? 6379,
        password: redisConfig.password,
        db: redisConfig.db ?? 0,
        ...(redisConfig.tls ? { tls: redisConfig.tls } : {}),
      });
    }
  }

  /** Expose the raw ioredis client for advanced usage. */
  getClient(): RedisType {
    return this.client;
  }

  private nowMs(): number {
    return Date.now();
  }

  // ── Events ──────────────────────────────────────────────────────────

  async recordJobEvent(
    jobId: number,
    eventType: JobEventType,
    metadata?: any,
  ): Promise<void> {
    try {
      const eventId = await this.client.incr(`${this.prefix}event_id_seq`);
      const event = JSON.stringify({
        id: eventId,
        jobId,
        eventType,
        createdAt: this.nowMs(),
        metadata: metadata ?? null,
      });
      await this.client.rpush(`${this.prefix}events:${jobId}`, event);
    } catch (error) {
      log(`Error recording job event for job ${jobId}: ${error}`);
      // Do not throw
    }
  }

  async getJobEvents(jobId: number): Promise<JobEvent[]> {
    const raw = await this.client.lrange(
      `${this.prefix}events:${jobId}`,
      0,
      -1,
    );
    return raw.map((r: string) => {
      const e = JSON.parse(r);
      return {
        ...e,
        createdAt: new Date(e.createdAt),
      };
    });
  }

  // ── Job CRUD ──────────────────────────────────────────────────────────

  async addJob<PayloadMap, T extends JobType<PayloadMap>>(
    {
      jobType,
      payload,
      maxAttempts = 3,
      priority = 0,
      runAt = null,
      timeoutMs = undefined,
      forceKillOnTimeout = false,
      tags = undefined,
      idempotencyKey = undefined,
      retryDelay = undefined,
      retryBackoff = undefined,
      retryDelayMax = undefined,
      group = undefined,
    }: JobOptions<PayloadMap, T>,
    options?: AddJobOptions,
  ): Promise<number> {
    if (options?.db) {
      throw new Error(
        'The db option is not supported with the Redis backend. ' +
          'Transactional job creation is only available with PostgreSQL.',
      );
    }
    const now = this.nowMs();
    const runAtMs = runAt ? runAt.getTime() : 0;

    const result = (await this.client.eval(
      ADD_JOB_SCRIPT,
      1,
      this.prefix,
      jobType,
      JSON.stringify(payload),
      maxAttempts,
      priority,
      runAtMs.toString(),
      timeoutMs !== undefined ? timeoutMs.toString() : 'null',
      forceKillOnTimeout ? 'true' : 'false',
      tags ? JSON.stringify(tags) : 'null',
      idempotencyKey ?? 'null',
      now,
      retryDelay !== undefined ? retryDelay.toString() : 'null',
      retryBackoff !== undefined ? retryBackoff.toString() : 'null',
      retryDelayMax !== undefined ? retryDelayMax.toString() : 'null',
      group?.id ?? 'null',
      group?.tier ?? 'null',
    )) as number;

    const jobId = Number(result);
    log(
      `Added job ${jobId}: payload ${JSON.stringify(payload)}, ${runAt ? `runAt ${runAt.toISOString()}, ` : ''}priority ${priority}, maxAttempts ${maxAttempts}, jobType ${jobType}, tags ${JSON.stringify(tags)}${idempotencyKey ? `, idempotencyKey "${idempotencyKey}"` : ''}`,
    );
    await this.recordJobEvent(jobId, JobEventType.Added, {
      jobType,
      payload,
      tags,
      idempotencyKey,
    });
    return jobId;
  }

  /**
   * Insert multiple jobs atomically via a single Lua script.
   * Returns IDs in the same order as the input array.
   */
  async addJobs<PayloadMap, T extends JobType<PayloadMap>>(
    jobs: JobOptions<PayloadMap, T>[],
    options?: AddJobOptions,
  ): Promise<number[]> {
    if (jobs.length === 0) return [];

    if (options?.db) {
      throw new Error(
        'The db option is not supported with the Redis backend. ' +
          'Transactional job creation is only available with PostgreSQL.',
      );
    }

    const now = this.nowMs();

    const jobsPayload = jobs.map((job) => ({
      jobType: job.jobType,
      payload: JSON.stringify(job.payload),
      maxAttempts: job.maxAttempts ?? 3,
      priority: job.priority ?? 0,
      runAtMs: job.runAt ? job.runAt.getTime() : 0,
      timeoutMs:
        job.timeoutMs !== undefined ? job.timeoutMs.toString() : 'null',
      forceKillOnTimeout: job.forceKillOnTimeout ? 'true' : 'false',
      tags: job.tags ? JSON.stringify(job.tags) : 'null',
      idempotencyKey: job.idempotencyKey ?? 'null',
      retryDelay:
        job.retryDelay !== undefined ? job.retryDelay.toString() : 'null',
      retryBackoff:
        job.retryBackoff !== undefined ? job.retryBackoff.toString() : 'null',
      retryDelayMax:
        job.retryDelayMax !== undefined ? job.retryDelayMax.toString() : 'null',
      groupId: job.group?.id ?? 'null',
      groupTier: job.group?.tier ?? 'null',
    }));

    const result = (await this.client.eval(
      ADD_JOBS_SCRIPT,
      1,
      this.prefix,
      JSON.stringify(jobsPayload),
      now,
    )) as number[];

    const ids = result.map(Number);
    log(`Batch-inserted ${jobs.length} jobs, IDs: [${ids.join(', ')}]`);

    // Record events for newly inserted jobs (skip idempotency duplicates)
    const existingIdempotencyIds = new Set<number>();
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].idempotencyKey) {
        // If the returned ID existed before this batch, it was a duplicate.
        // We detect this by checking if the same ID appears for a different
        // idempotency-keyed job (unlikely) or by checking if the ID was less
        // than what we'd expect. The simplest approach: record events for all,
        // since the Lua script returns the existing ID for duplicates but
        // doesn't tell us if it was newly created. We can compare: if
        // multiple jobs have the same idempotency key in the batch and got
        // the same ID, only record once.
        if (existingIdempotencyIds.has(ids[i])) {
          continue;
        }
        existingIdempotencyIds.add(ids[i]);
      }
      await this.recordJobEvent(ids[i], JobEventType.Added, {
        jobType: jobs[i].jobType,
        payload: jobs[i].payload,
        tags: jobs[i].tags,
        idempotencyKey: jobs[i].idempotencyKey,
      });
    }

    return ids;
  }

  async getJob<PayloadMap, T extends JobType<PayloadMap>>(
    id: number,
  ): Promise<JobRecord<PayloadMap, T> | null> {
    const data = await this.client.hgetall(`${this.prefix}job:${id}`);
    if (!data || Object.keys(data).length === 0) {
      log(`Job ${id} not found`);
      return null;
    }
    log(`Found job ${id}`);
    return deserializeJob<PayloadMap, T>(data);
  }

  async getJobsByStatus<PayloadMap, T extends JobType<PayloadMap>>(
    status: string,
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const ids = await this.client.smembers(`${this.prefix}status:${status}`);
    if (ids.length === 0) return [];

    // Load all, sort by createdAt DESC, then paginate
    const jobs = await this.loadJobsByIds<PayloadMap, T>(ids);
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return jobs.slice(offset, offset + limit);
  }

  async getAllJobs<PayloadMap, T extends JobType<PayloadMap>>(
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    // All jobs sorted by createdAt DESC (the 'all' sorted set is scored by createdAt ms)
    const ids = await this.client.zrevrange(
      `${this.prefix}all`,
      offset,
      offset + limit - 1,
    );
    if (ids.length === 0) return [];
    return this.loadJobsByIds<PayloadMap, T>(ids);
  }

  async getJobs<PayloadMap, T extends JobType<PayloadMap>>(
    filters?: JobFilters,
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    // Start with all job IDs
    let candidateIds: string[];

    if (filters?.jobType) {
      candidateIds = await this.client.smembers(
        `${this.prefix}type:${filters.jobType}`,
      );
    } else {
      candidateIds = await this.client.zrevrange(`${this.prefix}all`, 0, -1);
    }

    if (candidateIds.length === 0) return [];

    // Apply tag filter via set operations
    if (filters?.tags && filters.tags.values.length > 0) {
      candidateIds = await this.filterByTags(
        candidateIds,
        filters.tags.values,
        filters.tags.mode || 'all',
      );
    }

    // Load and filter remaining criteria in-memory
    let jobs = await this.loadJobsByIds<PayloadMap, T>(candidateIds);

    if (filters) {
      if (filters.priority !== undefined) {
        jobs = jobs.filter((j) => j.priority === filters.priority);
      }
      if (filters.runAt) {
        jobs = this.filterByRunAt(jobs, filters.runAt);
      }
      // Cursor-based (keyset) pagination: only return jobs with id < cursor
      if (filters.cursor !== undefined) {
        jobs = jobs.filter((j) => j.id < filters.cursor!);
      }
    }

    // Sort by id DESC for consistent keyset pagination (matches Postgres ORDER BY id DESC)
    jobs.sort((a, b) => b.id - a.id);

    // When using cursor, skip offset
    if (filters?.cursor !== undefined) {
      return jobs.slice(0, limit);
    }
    return jobs.slice(offset, offset + limit);
  }

  async getJobsByTags<PayloadMap, T extends JobType<PayloadMap>>(
    tags: string[],
    mode: TagQueryMode = 'all',
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    // Start with all IDs
    const allIds = await this.client.zrevrange(`${this.prefix}all`, 0, -1);
    if (allIds.length === 0) return [];

    const filtered = await this.filterByTags(allIds, tags, mode);
    if (filtered.length === 0) return [];

    const jobs = await this.loadJobsByIds<PayloadMap, T>(filtered);
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return jobs.slice(offset, offset + limit);
  }

  // ── Processing lifecycle ──────────────────────────────────────────────

  async getNextBatch<PayloadMap, T extends JobType<PayloadMap>>(
    workerId: string,
    batchSize = 10,
    jobType?: string | string[],
    groupConcurrency?: number,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const now = this.nowMs();
    const jobTypeFilter =
      jobType === undefined
        ? 'null'
        : Array.isArray(jobType)
          ? JSON.stringify(jobType)
          : jobType;

    const result = (await this.client.eval(
      GET_NEXT_BATCH_SCRIPT,
      1,
      this.prefix,
      workerId,
      batchSize,
      now,
      jobTypeFilter,
      groupConcurrency !== undefined ? groupConcurrency : 'null',
    )) as string[];

    if (!result || result.length === 0) {
      log('Found 0 jobs to process');
      return [];
    }

    // Parse the flat result into jobs separated by __JOB_SEP__
    const jobs: JobRecord<PayloadMap, T>[] = [];
    let current: string[] = [];
    for (const item of result) {
      if (item === '__JOB_SEP__') {
        if (current.length > 0) {
          const h = hashToObject(current);
          jobs.push(deserializeJob<PayloadMap, T>(h));
        }
        current = [];
      } else {
        current.push(item);
      }
    }

    log(`Found ${jobs.length} jobs to process`);

    // Record processing events
    for (const job of jobs) {
      await this.recordJobEvent(job.id, JobEventType.Processing);
    }

    return jobs;
  }

  async completeJob(jobId: number, output?: unknown): Promise<void> {
    const now = this.nowMs();
    const outputArg =
      output !== undefined ? JSON.stringify(output) : '__NONE__';
    await this.client.eval(
      COMPLETE_JOB_SCRIPT,
      1,
      this.prefix,
      jobId,
      now,
      outputArg,
    );
    await this.recordJobEvent(jobId, JobEventType.Completed);
    log(`Completed job ${jobId}`);
  }

  async failJob(
    jobId: number,
    error: Error,
    failureReason?: FailureReason,
  ): Promise<void> {
    const now = this.nowMs();
    const errorJson = JSON.stringify([
      {
        message: error.message || String(error),
        timestamp: new Date(now).toISOString(),
      },
    ]);
    await this.client.eval(
      FAIL_JOB_SCRIPT,
      1,
      this.prefix,
      jobId,
      errorJson,
      failureReason ?? 'null',
      now,
    );
    await this.recordJobEvent(jobId, JobEventType.Failed, {
      message: error.message || String(error),
      failureReason,
    });
    log(`Failed job ${jobId}`);
  }

  async prolongJob(jobId: number): Promise<void> {
    try {
      const now = this.nowMs();
      await this.client.eval(PROLONG_JOB_SCRIPT, 1, this.prefix, jobId, now);
      await this.recordJobEvent(jobId, JobEventType.Prolonged);
      log(`Prolonged job ${jobId}`);
    } catch (error) {
      log(`Error prolonging job ${jobId}: ${error}`);
      // Best-effort, do not throw
    }
  }

  // ── Progress ──────────────────────────────────────────────────────────

  async updateProgress(jobId: number, progress: number): Promise<void> {
    try {
      const now = this.nowMs();
      await this.client.hset(
        `${this.prefix}job:${jobId}`,
        'progress',
        progress.toString(),
        'updatedAt',
        now.toString(),
      );
      log(`Updated progress for job ${jobId}: ${progress}%`);
    } catch (error) {
      log(`Error updating progress for job ${jobId}: ${error}`);
      // Best-effort: do not throw to avoid killing the running handler
    }
  }

  // ── Output ────────────────────────────────────────────────────────────

  async updateOutput(jobId: number, output: unknown): Promise<void> {
    try {
      const now = this.nowMs();
      await this.client.hset(
        `${this.prefix}job:${jobId}`,
        'output',
        JSON.stringify(output),
        'updatedAt',
        now.toString(),
      );
      log(`Updated output for job ${jobId}`);
    } catch (error) {
      log(`Error updating output for job ${jobId}: ${error}`);
    }
  }

  // ── Job management ────────────────────────────────────────────────────

  async retryJob(jobId: number): Promise<void> {
    const now = this.nowMs();
    await this.client.eval(RETRY_JOB_SCRIPT, 1, this.prefix, jobId, now);
    await this.recordJobEvent(jobId, JobEventType.Retried);
    log(`Retried job ${jobId}`);
  }

  async cancelJob(jobId: number): Promise<void> {
    const now = this.nowMs();
    await this.client.eval(CANCEL_JOB_SCRIPT, 1, this.prefix, jobId, now);
    await this.recordJobEvent(jobId, JobEventType.Cancelled);
    log(`Cancelled job ${jobId}`);
  }

  async cancelAllUpcomingJobs(filters?: JobFilters): Promise<number> {
    // Get all pending IDs
    let ids = await this.client.smembers(`${this.prefix}status:pending`);
    if (ids.length === 0) return 0;

    if (filters) {
      ids = await this.applyFilters(ids, filters);
    }

    const now = this.nowMs();
    let count = 0;
    for (const id of ids) {
      const result = await this.client.eval(
        CANCEL_JOB_SCRIPT,
        1,
        this.prefix,
        id,
        now,
      );
      if (Number(result) === 1) count++;
    }

    log(`Cancelled ${count} jobs`);
    return count;
  }

  async editJob(jobId: number, updates: JobUpdates): Promise<void> {
    const jk = `${this.prefix}job:${jobId}`;
    const status = await this.client.hget(jk, 'status');
    if (status !== 'pending') {
      log(`Job ${jobId} is not pending (status: ${status}), skipping edit`);
      return;
    }

    const now = this.nowMs();
    const fields: string[] = [];
    const metadata: any = {};

    if (updates.payload !== undefined) {
      fields.push('payload', JSON.stringify(updates.payload));
      metadata.payload = updates.payload;
    }
    if (updates.maxAttempts !== undefined) {
      fields.push('maxAttempts', updates.maxAttempts.toString());
      metadata.maxAttempts = updates.maxAttempts;
    }
    if (updates.priority !== undefined) {
      fields.push('priority', updates.priority.toString());
      metadata.priority = updates.priority;

      // Recompute queue score
      const createdAt = await this.client.hget(jk, 'createdAt');
      const score = updates.priority * 1e15 + (1e15 - Number(createdAt));
      // Update score in queue if present
      const inQueue = await this.client.zscore(
        `${this.prefix}queue`,
        jobId.toString(),
      );
      if (inQueue !== null) {
        await this.client.zadd(`${this.prefix}queue`, score, jobId.toString());
      }
    }
    if (updates.runAt !== undefined) {
      if (updates.runAt === null) {
        fields.push('runAt', now.toString());
      } else {
        fields.push('runAt', updates.runAt.getTime().toString());
      }
      metadata.runAt = updates.runAt;
    }
    if (updates.timeoutMs !== undefined) {
      fields.push(
        'timeoutMs',
        updates.timeoutMs !== null ? updates.timeoutMs.toString() : 'null',
      );
      metadata.timeoutMs = updates.timeoutMs;
    }
    if (updates.tags !== undefined) {
      // Update tag indexes: remove old, add new
      const oldTagsJson = await this.client.hget(jk, 'tags');
      if (oldTagsJson && oldTagsJson !== 'null') {
        try {
          const oldTags = JSON.parse(oldTagsJson) as string[];
          for (const tag of oldTags) {
            await this.client.srem(
              `${this.prefix}tag:${tag}`,
              jobId.toString(),
            );
          }
        } catch {
          /* ignore */
        }
      }
      await this.client.del(`${this.prefix}job:${jobId}:tags`);

      if (updates.tags !== null) {
        for (const tag of updates.tags) {
          await this.client.sadd(`${this.prefix}tag:${tag}`, jobId.toString());
          await this.client.sadd(`${this.prefix}job:${jobId}:tags`, tag);
        }
        fields.push('tags', JSON.stringify(updates.tags));
      } else {
        fields.push('tags', 'null');
      }
      metadata.tags = updates.tags;
    }
    if (updates.retryDelay !== undefined) {
      fields.push(
        'retryDelay',
        updates.retryDelay !== null ? updates.retryDelay.toString() : 'null',
      );
      metadata.retryDelay = updates.retryDelay;
    }
    if (updates.retryBackoff !== undefined) {
      fields.push(
        'retryBackoff',
        updates.retryBackoff !== null
          ? updates.retryBackoff.toString()
          : 'null',
      );
      metadata.retryBackoff = updates.retryBackoff;
    }
    if (updates.retryDelayMax !== undefined) {
      fields.push(
        'retryDelayMax',
        updates.retryDelayMax !== null
          ? updates.retryDelayMax.toString()
          : 'null',
      );
      metadata.retryDelayMax = updates.retryDelayMax;
    }

    if (fields.length === 0) {
      log(`No fields to update for job ${jobId}`);
      return;
    }

    fields.push('updatedAt', now.toString());
    await (this.client as any).hmset(jk, ...fields);

    await this.recordJobEvent(jobId, JobEventType.Edited, metadata);
    log(`Edited job ${jobId}: ${JSON.stringify(metadata)}`);
  }

  async editAllPendingJobs(
    filters: JobFilters | undefined,
    updates: JobUpdates,
  ): Promise<number> {
    let ids = await this.client.smembers(`${this.prefix}status:pending`);
    if (ids.length === 0) return 0;

    if (filters) {
      ids = await this.applyFilters(ids, filters);
    }

    let count = 0;
    for (const id of ids) {
      await this.editJob(Number(id), updates);
      count++;
    }

    log(`Edited ${count} pending jobs`);
    return count;
  }

  /**
   * Delete completed jobs older than the given number of days.
   * Uses SSCAN to iterate the completed set in batches, avoiding
   * loading all IDs into memory and preventing long Redis blocks.
   *
   * @param daysToKeep - Number of days to retain completed jobs (default 30).
   * @param batchSize - Number of IDs to scan per SSCAN iteration (default 200).
   * @returns Total number of deleted jobs.
   */
  async cleanupOldJobs(daysToKeep = 30, batchSize = 200): Promise<number> {
    const cutoffMs = this.nowMs() - daysToKeep * 24 * 60 * 60 * 1000;
    const setKey = `${this.prefix}status:completed`;
    let totalDeleted = 0;
    let cursor = '0';

    do {
      const [nextCursor, ids] = await this.client.sscan(
        setKey,
        cursor,
        'COUNT',
        batchSize,
      );
      cursor = nextCursor;

      if (ids.length > 0) {
        const result = (await this.client.eval(
          CLEANUP_OLD_JOBS_BATCH_SCRIPT,
          1,
          this.prefix,
          cutoffMs,
          ...ids,
        )) as number;
        totalDeleted += Number(result);
      }
    } while (cursor !== '0');

    log(`Deleted ${totalDeleted} old jobs`);
    return totalDeleted;
  }

  /**
   * Delete job events older than the given number of days.
   * Iterates all event lists and removes events whose createdAt is before the cutoff.
   * Also removes orphaned event lists (where the job no longer exists).
   *
   * @param daysToKeep - Number of days to retain events (default 30).
   * @param batchSize - Number of event keys to scan per SCAN iteration (default 200).
   * @returns Total number of deleted events.
   */
  async cleanupOldJobEvents(daysToKeep = 30, batchSize = 200): Promise<number> {
    const cutoffMs = this.nowMs() - daysToKeep * 24 * 60 * 60 * 1000;
    const pattern = `${this.prefix}events:*`;
    let totalDeleted = 0;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        batchSize,
      );
      cursor = nextCursor;

      for (const key of keys) {
        // Check if the job still exists; if not, delete the entire event list
        const jobIdStr = key.slice(`${this.prefix}events:`.length);
        const jobExists = await this.client.exists(
          `${this.prefix}job:${jobIdStr}`,
        );
        if (!jobExists) {
          const len = await this.client.llen(key);
          await this.client.del(key);
          totalDeleted += len;
          continue;
        }

        // Filter events by date: read all, keep recent, rewrite
        const events = await this.client.lrange(key, 0, -1);
        const kept: string[] = [];
        for (const raw of events) {
          try {
            const e = JSON.parse(raw);
            if (e.createdAt >= cutoffMs) {
              kept.push(raw);
            } else {
              totalDeleted++;
            }
          } catch {
            totalDeleted++;
          }
        }

        if (kept.length === 0) {
          await this.client.del(key);
        } else if (kept.length < events.length) {
          const pipeline = this.client.pipeline();
          pipeline.del(key);
          for (const raw of kept) {
            pipeline.rpush(key, raw);
          }
          await pipeline.exec();
        }
      }
    } while (cursor !== '0');

    log(`Deleted ${totalDeleted} old job events`);
    return totalDeleted;
  }

  async reclaimStuckJobs(maxProcessingTimeMinutes = 10): Promise<number> {
    const maxAgeMs = maxProcessingTimeMinutes * 60 * 1000;
    const now = this.nowMs();
    const result = (await this.client.eval(
      RECLAIM_STUCK_JOBS_SCRIPT,
      1,
      this.prefix,
      maxAgeMs,
      now,
    )) as number;
    log(`Reclaimed ${result} stuck jobs`);
    return Number(result);
  }

  // ── Wait / step-data support ────────────────────────────────────────

  /**
   * Transition a job from 'processing' to 'waiting' status.
   * Persists step data so the handler can resume from where it left off.
   *
   * @param jobId - The job to pause.
   * @param options - Wait configuration including optional waitUntil date, token ID, and step data.
   */
  async waitJob(
    jobId: number,
    options: {
      waitUntil?: Date;
      waitTokenId?: string;
      stepData: Record<string, any>;
    },
  ): Promise<void> {
    const now = this.nowMs();
    const waitUntilMs = options.waitUntil
      ? options.waitUntil.getTime().toString()
      : 'null';
    const waitTokenId = options.waitTokenId ?? 'null';
    const stepDataJson = JSON.stringify(options.stepData);

    const result = await this.client.eval(
      WAIT_JOB_SCRIPT,
      1,
      this.prefix,
      jobId,
      waitUntilMs,
      waitTokenId,
      stepDataJson,
      now,
    );

    if (Number(result) === 0) {
      log(
        `Job ${jobId} could not be set to waiting (may have been reclaimed or is no longer processing)`,
      );
      return;
    }

    await this.recordJobEvent(jobId, JobEventType.Waiting, {
      waitUntil: options.waitUntil?.toISOString() ?? null,
      waitTokenId: options.waitTokenId ?? null,
    });
    log(`Job ${jobId} set to waiting`);
  }

  /**
   * Persist step data for a job. Called after each ctx.run() step completes.
   * Best-effort: does not throw to avoid killing the running handler.
   *
   * @param jobId - The job to update.
   * @param stepData - The step data to persist.
   */
  async updateStepData(
    jobId: number,
    stepData: Record<string, any>,
  ): Promise<void> {
    try {
      const now = this.nowMs();
      await this.client.hset(
        `${this.prefix}job:${jobId}`,
        'stepData',
        JSON.stringify(stepData),
        'updatedAt',
        now.toString(),
      );
    } catch (error) {
      log(`Error updating stepData for job ${jobId}: ${error}`);
    }
  }

  /**
   * Create a waitpoint token.
   *
   * @param jobId - The job ID to associate with the token (null if created outside a handler).
   * @param options - Optional timeout string (e.g. '10m', '1h') and tags.
   * @returns The created waitpoint with its unique ID.
   */
  async createWaitpoint(
    jobId: number | null,
    options?: CreateTokenOptions,
  ): Promise<{ id: string }> {
    const id = `wp_${randomUUID()}`;
    const now = this.nowMs();
    let timeoutAt: number | null = null;

    if (options?.timeout) {
      const ms = parseTimeoutString(options.timeout);
      timeoutAt = now + ms;
    }

    const key = `${this.prefix}waitpoint:${id}`;
    const fields: string[] = [
      'id',
      id,
      'jobId',
      jobId !== null ? jobId.toString() : 'null',
      'status',
      'waiting',
      'output',
      'null',
      'timeoutAt',
      timeoutAt !== null ? timeoutAt.toString() : 'null',
      'createdAt',
      now.toString(),
      'completedAt',
      'null',
      'tags',
      options?.tags ? JSON.stringify(options.tags) : 'null',
    ];

    await (this.client as any).hmset(key, ...fields);

    if (timeoutAt !== null) {
      await this.client.zadd(`${this.prefix}waitpoint_timeout`, timeoutAt, id);
    }

    log(`Created waitpoint ${id} for job ${jobId}`);
    return { id };
  }

  /**
   * Complete a waitpoint token and move the associated job back to 'pending'.
   *
   * @param tokenId - The waitpoint token ID to complete.
   * @param data - Optional data to pass to the waiting handler.
   */
  async completeWaitpoint(tokenId: string, data?: any): Promise<void> {
    const now = this.nowMs();
    const outputJson = data != null ? JSON.stringify(data) : 'null';

    const result = await this.client.eval(
      COMPLETE_WAITPOINT_SCRIPT,
      1,
      this.prefix,
      tokenId,
      outputJson,
      now,
    );

    if (Number(result) === 0) {
      log(`Waitpoint ${tokenId} not found or already completed`);
      return;
    }

    log(`Completed waitpoint ${tokenId}`);
  }

  /**
   * Retrieve a waitpoint token by its ID.
   *
   * @param tokenId - The waitpoint token ID to look up.
   * @returns The waitpoint record, or null if not found.
   */
  async getWaitpoint(tokenId: string): Promise<WaitpointRecord | null> {
    const data = await this.client.hgetall(
      `${this.prefix}waitpoint:${tokenId}`,
    );
    if (!data || Object.keys(data).length === 0) return null;

    const nullish = (v: string | undefined) =>
      v === undefined || v === 'null' || v === '' ? null : v;
    const numOrNull = (v: string | undefined): number | null => {
      const n = nullish(v);
      return n === null ? null : Number(n);
    };
    const dateOrNull = (v: string | undefined): Date | null => {
      const n = numOrNull(v);
      return n === null ? null : new Date(n);
    };

    let output: any = null;
    if (data.output && data.output !== 'null') {
      try {
        output = JSON.parse(data.output);
      } catch {
        output = data.output;
      }
    }

    let tags: string[] | null = null;
    if (data.tags && data.tags !== 'null') {
      try {
        tags = JSON.parse(data.tags);
      } catch {
        /* ignore */
      }
    }

    return {
      id: data.id,
      jobId: numOrNull(data.jobId),
      status: data.status as WaitpointRecord['status'],
      output,
      timeoutAt: dateOrNull(data.timeoutAt),
      createdAt: new Date(Number(data.createdAt)),
      completedAt: dateOrNull(data.completedAt),
      tags,
    };
  }

  /**
   * Expire timed-out waitpoint tokens and move their associated jobs back to 'pending'.
   *
   * @returns The number of tokens that were expired.
   */
  async expireTimedOutWaitpoints(): Promise<number> {
    const now = this.nowMs();
    const result = (await this.client.eval(
      EXPIRE_TIMED_OUT_WAITPOINTS_SCRIPT,
      1,
      this.prefix,
      now,
    )) as number;
    const count = Number(result);
    if (count > 0) {
      log(`Expired ${count} timed-out waitpoints`);
    }
    return count;
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  async setPendingReasonForUnpickedJobs(
    reason: string,
    jobType?: string | string[],
  ): Promise<void> {
    let ids = await this.client.smembers(`${this.prefix}status:pending`);
    if (ids.length === 0) return;

    if (jobType) {
      const types = Array.isArray(jobType) ? jobType : [jobType];
      const typeSet = new Set<string>();
      for (const t of types) {
        const typeIds = await this.client.smembers(`${this.prefix}type:${t}`);
        for (const id of typeIds) typeSet.add(id);
      }
      ids = ids.filter((id: string) => typeSet.has(id));
    }

    for (const id of ids) {
      await this.client.hset(
        `${this.prefix}job:${id}`,
        'pendingReason',
        reason,
      );
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async loadJobsByIds<PayloadMap, T extends JobType<PayloadMap>>(
    ids: string[],
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.hgetall(`${this.prefix}job:${id}`);
    }
    const results = await pipeline.exec();
    const jobs: JobRecord<PayloadMap, T>[] = [];
    if (results) {
      for (const [err, data] of results) {
        if (
          !err &&
          data &&
          typeof data === 'object' &&
          Object.keys(data as object).length > 0
        ) {
          jobs.push(
            deserializeJob<PayloadMap, T>(data as Record<string, string>),
          );
        }
      }
    }
    return jobs;
  }

  private async filterByTags(
    candidateIds: string[],
    tags: string[],
    mode: TagQueryMode,
  ): Promise<string[]> {
    const candidateSet = new Set(candidateIds.map(String));

    if (mode === 'exact') {
      // Jobs whose tags set is exactly equal to the given tags
      const tagSet = new Set(tags);
      const result: string[] = [];
      for (const id of candidateIds) {
        const jobTags = await this.client.smembers(
          `${this.prefix}job:${id}:tags`,
        );
        if (
          jobTags.length === tagSet.size &&
          jobTags.every((t: string) => tagSet.has(t))
        ) {
          result.push(id);
        }
      }
      return result;
    }

    if (mode === 'all') {
      // Jobs that have ALL the given tags
      let intersection = new Set(candidateIds.map(String));
      for (const tag of tags) {
        const tagMembers = await this.client.smembers(
          `${this.prefix}tag:${tag}`,
        );
        const tagSet = new Set(tagMembers.map(String));
        intersection = new Set(
          [...intersection].filter((id) => tagSet.has(id)),
        );
      }
      return [...intersection].filter((id) => candidateSet.has(id));
    }

    if (mode === 'any') {
      // Jobs that have at least ONE of the given tags
      const union = new Set<string>();
      for (const tag of tags) {
        const tagMembers = await this.client.smembers(
          `${this.prefix}tag:${tag}`,
        );
        for (const id of tagMembers) union.add(String(id));
      }
      return [...union].filter((id) => candidateSet.has(id));
    }

    if (mode === 'none') {
      // Jobs that have NONE of the given tags
      const exclude = new Set<string>();
      for (const tag of tags) {
        const tagMembers = await this.client.smembers(
          `${this.prefix}tag:${tag}`,
        );
        for (const id of tagMembers) exclude.add(String(id));
      }
      return candidateIds.filter((id) => !exclude.has(String(id)));
    }

    // Default: 'all'
    return this.filterByTags(candidateIds, tags, 'all');
  }

  private filterByRunAt<PayloadMap, T extends JobType<PayloadMap>>(
    jobs: JobRecord<PayloadMap, T>[],
    runAt: Date | { gt?: Date; gte?: Date; lt?: Date; lte?: Date; eq?: Date },
  ): JobRecord<PayloadMap, T>[] {
    if (runAt instanceof Date) {
      return jobs.filter((j) => j.runAt.getTime() === runAt.getTime());
    }
    return jobs.filter((j) => {
      const t = j.runAt.getTime();
      if (runAt.gt && !(t > runAt.gt.getTime())) return false;
      if (runAt.gte && !(t >= runAt.gte.getTime())) return false;
      if (runAt.lt && !(t < runAt.lt.getTime())) return false;
      if (runAt.lte && !(t <= runAt.lte.getTime())) return false;
      if (runAt.eq && t !== runAt.eq.getTime()) return false;
      return true;
    });
  }

  // ── Cron schedules ──────────────────────────────────────────────────

  /** Create a cron schedule and return its ID. */
  async addCronSchedule(input: CronScheduleInput): Promise<number> {
    const existingId = await this.client.get(
      `${this.prefix}cron_name:${input.scheduleName}`,
    );
    if (existingId !== null) {
      throw new Error(
        `Cron schedule with name "${input.scheduleName}" already exists`,
      );
    }

    const id = await this.client.incr(`${this.prefix}cron_id_seq`);
    const now = this.nowMs();
    const key = `${this.prefix}cron:${id}`;

    const fields: string[] = [
      'id',
      id.toString(),
      'scheduleName',
      input.scheduleName,
      'cronExpression',
      input.cronExpression,
      'jobType',
      input.jobType,
      'payload',
      JSON.stringify(input.payload),
      'maxAttempts',
      input.maxAttempts.toString(),
      'priority',
      input.priority.toString(),
      'timeoutMs',
      input.timeoutMs !== null ? input.timeoutMs.toString() : 'null',
      'forceKillOnTimeout',
      input.forceKillOnTimeout ? 'true' : 'false',
      'tags',
      input.tags ? JSON.stringify(input.tags) : 'null',
      'timezone',
      input.timezone,
      'allowOverlap',
      input.allowOverlap ? 'true' : 'false',
      'status',
      'active',
      'lastEnqueuedAt',
      'null',
      'lastJobId',
      'null',
      'nextRunAt',
      input.nextRunAt ? input.nextRunAt.getTime().toString() : 'null',
      'createdAt',
      now.toString(),
      'updatedAt',
      now.toString(),
      'retryDelay',
      input.retryDelay !== null && input.retryDelay !== undefined
        ? input.retryDelay.toString()
        : 'null',
      'retryBackoff',
      input.retryBackoff !== null && input.retryBackoff !== undefined
        ? input.retryBackoff.toString()
        : 'null',
      'retryDelayMax',
      input.retryDelayMax !== null && input.retryDelayMax !== undefined
        ? input.retryDelayMax.toString()
        : 'null',
    ];

    await (this.client as any).hmset(key, ...fields);
    await this.client.set(
      `${this.prefix}cron_name:${input.scheduleName}`,
      id.toString(),
    );
    await this.client.sadd(`${this.prefix}crons`, id.toString());
    await this.client.sadd(`${this.prefix}cron_status:active`, id.toString());

    if (input.nextRunAt) {
      await this.client.zadd(
        `${this.prefix}cron_due`,
        input.nextRunAt.getTime(),
        id.toString(),
      );
    }

    log(`Added cron schedule ${id}: "${input.scheduleName}"`);
    return id;
  }

  /** Get a cron schedule by ID. */
  async getCronSchedule(id: number): Promise<CronScheduleRecord | null> {
    const data = await this.client.hgetall(`${this.prefix}cron:${id}`);
    if (!data || Object.keys(data).length === 0) return null;
    return this.deserializeCronSchedule(data);
  }

  /** Get a cron schedule by its unique name. */
  async getCronScheduleByName(
    name: string,
  ): Promise<CronScheduleRecord | null> {
    const id = await this.client.get(`${this.prefix}cron_name:${name}`);
    if (id === null) return null;
    return this.getCronSchedule(Number(id));
  }

  /** List cron schedules, optionally filtered by status. */
  async listCronSchedules(
    status?: CronScheduleStatus,
  ): Promise<CronScheduleRecord[]> {
    let ids: string[];
    if (status) {
      ids = await this.client.smembers(`${this.prefix}cron_status:${status}`);
    } else {
      ids = await this.client.smembers(`${this.prefix}crons`);
    }
    if (ids.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.hgetall(`${this.prefix}cron:${id}`);
    }
    const results = await pipeline.exec();
    const schedules: CronScheduleRecord[] = [];
    if (results) {
      for (const [err, data] of results) {
        if (
          !err &&
          data &&
          typeof data === 'object' &&
          Object.keys(data as object).length > 0
        ) {
          schedules.push(
            this.deserializeCronSchedule(data as Record<string, string>),
          );
        }
      }
    }
    schedules.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return schedules;
  }

  /** Delete a cron schedule by ID. */
  async removeCronSchedule(id: number): Promise<void> {
    const data = await this.client.hgetall(`${this.prefix}cron:${id}`);
    if (!data || Object.keys(data).length === 0) return;

    const name = data.scheduleName;
    const status = data.status;

    await this.client.del(`${this.prefix}cron:${id}`);
    await this.client.del(`${this.prefix}cron_name:${name}`);
    await this.client.srem(`${this.prefix}crons`, id.toString());
    await this.client.srem(
      `${this.prefix}cron_status:${status}`,
      id.toString(),
    );
    await this.client.zrem(`${this.prefix}cron_due`, id.toString());
    log(`Removed cron schedule ${id}`);
  }

  /** Pause a cron schedule. */
  async pauseCronSchedule(id: number): Promise<void> {
    const now = this.nowMs();
    await this.client.hset(
      `${this.prefix}cron:${id}`,
      'status',
      'paused',
      'updatedAt',
      now.toString(),
    );
    await this.client.srem(`${this.prefix}cron_status:active`, id.toString());
    await this.client.sadd(`${this.prefix}cron_status:paused`, id.toString());
    await this.client.zrem(`${this.prefix}cron_due`, id.toString());
    log(`Paused cron schedule ${id}`);
  }

  /** Resume a paused cron schedule. */
  async resumeCronSchedule(id: number): Promise<void> {
    const now = this.nowMs();
    await this.client.hset(
      `${this.prefix}cron:${id}`,
      'status',
      'active',
      'updatedAt',
      now.toString(),
    );
    await this.client.srem(`${this.prefix}cron_status:paused`, id.toString());
    await this.client.sadd(`${this.prefix}cron_status:active`, id.toString());

    const nextRunAt = await this.client.hget(
      `${this.prefix}cron:${id}`,
      'nextRunAt',
    );
    if (nextRunAt && nextRunAt !== 'null') {
      await this.client.zadd(
        `${this.prefix}cron_due`,
        Number(nextRunAt),
        id.toString(),
      );
    }
    log(`Resumed cron schedule ${id}`);
  }

  /** Edit a cron schedule. */
  async editCronSchedule(
    id: number,
    updates: EditCronScheduleOptions,
    nextRunAt?: Date | null,
  ): Promise<void> {
    const now = this.nowMs();
    const fields: string[] = [];

    if (updates.cronExpression !== undefined) {
      fields.push('cronExpression', updates.cronExpression);
    }
    if (updates.payload !== undefined) {
      fields.push('payload', JSON.stringify(updates.payload));
    }
    if (updates.maxAttempts !== undefined) {
      fields.push('maxAttempts', updates.maxAttempts.toString());
    }
    if (updates.priority !== undefined) {
      fields.push('priority', updates.priority.toString());
    }
    if (updates.timeoutMs !== undefined) {
      fields.push(
        'timeoutMs',
        updates.timeoutMs !== null ? updates.timeoutMs.toString() : 'null',
      );
    }
    if (updates.forceKillOnTimeout !== undefined) {
      fields.push(
        'forceKillOnTimeout',
        updates.forceKillOnTimeout ? 'true' : 'false',
      );
    }
    if (updates.tags !== undefined) {
      fields.push(
        'tags',
        updates.tags !== null ? JSON.stringify(updates.tags) : 'null',
      );
    }
    if (updates.timezone !== undefined) {
      fields.push('timezone', updates.timezone);
    }
    if (updates.allowOverlap !== undefined) {
      fields.push('allowOverlap', updates.allowOverlap ? 'true' : 'false');
    }
    if (updates.retryDelay !== undefined) {
      fields.push(
        'retryDelay',
        updates.retryDelay !== null ? updates.retryDelay.toString() : 'null',
      );
    }
    if (updates.retryBackoff !== undefined) {
      fields.push(
        'retryBackoff',
        updates.retryBackoff !== null
          ? updates.retryBackoff.toString()
          : 'null',
      );
    }
    if (updates.retryDelayMax !== undefined) {
      fields.push(
        'retryDelayMax',
        updates.retryDelayMax !== null
          ? updates.retryDelayMax.toString()
          : 'null',
      );
    }
    if (nextRunAt !== undefined) {
      const val = nextRunAt !== null ? nextRunAt.getTime().toString() : 'null';
      fields.push('nextRunAt', val);
      if (nextRunAt !== null) {
        await this.client.zadd(
          `${this.prefix}cron_due`,
          nextRunAt.getTime(),
          id.toString(),
        );
      } else {
        await this.client.zrem(`${this.prefix}cron_due`, id.toString());
      }
    }

    if (fields.length === 0) {
      log(`No fields to update for cron schedule ${id}`);
      return;
    }

    fields.push('updatedAt', now.toString());
    await (this.client as any).hmset(`${this.prefix}cron:${id}`, ...fields);
    log(`Edited cron schedule ${id}`);
  }

  /**
   * Fetch all active cron schedules whose nextRunAt <= now.
   * Uses a sorted set (cron_due) for efficient range query.
   */
  async getDueCronSchedules(): Promise<CronScheduleRecord[]> {
    const now = this.nowMs();
    const ids = await this.client.zrangebyscore(
      `${this.prefix}cron_due`,
      0,
      now,
    );
    if (ids.length === 0) {
      log('Found 0 due cron schedules');
      return [];
    }

    const schedules: CronScheduleRecord[] = [];
    for (const id of ids) {
      const data = await this.client.hgetall(`${this.prefix}cron:${id}`);
      if (data && Object.keys(data).length > 0 && data.status === 'active') {
        schedules.push(this.deserializeCronSchedule(data));
      }
    }
    log(`Found ${schedules.length} due cron schedules`);
    return schedules;
  }

  /**
   * Update a cron schedule after a job has been enqueued.
   * Sets lastEnqueuedAt, lastJobId, and advances nextRunAt.
   */
  async updateCronScheduleAfterEnqueue(
    id: number,
    lastEnqueuedAt: Date,
    lastJobId: number,
    nextRunAt: Date | null,
  ): Promise<void> {
    const fields: string[] = [
      'lastEnqueuedAt',
      lastEnqueuedAt.getTime().toString(),
      'lastJobId',
      lastJobId.toString(),
      'nextRunAt',
      nextRunAt ? nextRunAt.getTime().toString() : 'null',
      'updatedAt',
      this.nowMs().toString(),
    ];

    await (this.client as any).hmset(`${this.prefix}cron:${id}`, ...fields);

    if (nextRunAt) {
      await this.client.zadd(
        `${this.prefix}cron_due`,
        nextRunAt.getTime(),
        id.toString(),
      );
    } else {
      await this.client.zrem(`${this.prefix}cron_due`, id.toString());
    }

    log(
      `Updated cron schedule ${id}: lastJobId=${lastJobId}, nextRunAt=${nextRunAt?.toISOString() ?? 'null'}`,
    );
  }

  /** Deserialize a Redis hash into a CronScheduleRecord. */
  private deserializeCronSchedule(
    h: Record<string, string>,
  ): CronScheduleRecord {
    const nullish = (v: string | undefined) =>
      v === undefined || v === 'null' || v === '' ? null : v;
    const numOrNull = (v: string | undefined): number | null => {
      const n = nullish(v);
      return n === null ? null : Number(n);
    };
    const dateOrNull = (v: string | undefined): Date | null => {
      const n = numOrNull(v);
      return n === null ? null : new Date(n);
    };

    let payload: any;
    try {
      payload = JSON.parse(h.payload);
    } catch {
      payload = h.payload;
    }

    let tags: string[] | undefined;
    try {
      const raw = h.tags;
      if (raw && raw !== 'null') {
        tags = JSON.parse(raw);
      }
    } catch {
      /* ignore */
    }

    return {
      id: Number(h.id),
      scheduleName: h.scheduleName,
      cronExpression: h.cronExpression,
      jobType: h.jobType,
      payload,
      maxAttempts: Number(h.maxAttempts),
      priority: Number(h.priority),
      timeoutMs: numOrNull(h.timeoutMs),
      forceKillOnTimeout: h.forceKillOnTimeout === 'true',
      tags,
      timezone: h.timezone,
      allowOverlap: h.allowOverlap === 'true',
      status: h.status as CronScheduleStatus,
      lastEnqueuedAt: dateOrNull(h.lastEnqueuedAt),
      lastJobId: numOrNull(h.lastJobId),
      nextRunAt: dateOrNull(h.nextRunAt),
      createdAt: new Date(Number(h.createdAt)),
      updatedAt: new Date(Number(h.updatedAt)),
      retryDelay: numOrNull(h.retryDelay),
      retryBackoff:
        h.retryBackoff === 'true'
          ? true
          : h.retryBackoff === 'false'
            ? false
            : null,
      retryDelayMax: numOrNull(h.retryDelayMax),
    };
  }

  // ── Private helpers (filters) ─────────────────────────────────────────

  private async applyFilters(
    ids: string[],
    filters: JobFilters,
  ): Promise<string[]> {
    let result = ids;

    if (filters.jobType) {
      const typeIds = new Set(
        await this.client.smembers(`${this.prefix}type:${filters.jobType}`),
      );
      result = result.filter((id) => typeIds.has(id));
    }

    if (filters.tags && filters.tags.values.length > 0) {
      result = await this.filterByTags(
        result,
        filters.tags.values,
        filters.tags.mode || 'all',
      );
    }

    // For priority and runAt, we need to load job data
    if (filters.priority !== undefined || filters.runAt) {
      const jobs = await this.loadJobsByIds(result);
      let filtered = jobs;
      if (filters.priority !== undefined) {
        filtered = filtered.filter((j) => j.priority === filters.priority);
      }
      if (filters.runAt) {
        filtered = this.filterByRunAt(filtered, filters.runAt);
      }
      result = filtered.map((j) => j.id.toString());
    }

    return result;
  }
}
