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
} from '../types.js';
import { QueueBackend, JobFilters, JobUpdates } from '../backend.js';
import { log } from '../log-context.js';
import {
  ADD_JOB_SCRIPT,
  GET_NEXT_BATCH_SCRIPT,
  COMPLETE_JOB_SCRIPT,
  FAIL_JOB_SCRIPT,
  RETRY_JOB_SCRIPT,
  CANCEL_JOB_SCRIPT,
  PROLONG_JOB_SCRIPT,
  RECLAIM_STUCK_JOBS_SCRIPT,
  CLEANUP_OLD_JOBS_SCRIPT,
} from './redis-scripts.js';

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
  };
}

export class RedisBackend implements QueueBackend {
  private client: RedisType;
  private prefix: string;

  constructor(redisConfig: RedisJobQueueConfig['redisConfig']) {
    // Dynamically require ioredis to avoid hard dep
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

  async addJob<PayloadMap, T extends JobType<PayloadMap>>({
    jobType,
    payload,
    maxAttempts = 3,
    priority = 0,
    runAt = null,
    timeoutMs = undefined,
    forceKillOnTimeout = false,
    tags = undefined,
    idempotencyKey = undefined,
  }: JobOptions<PayloadMap, T>): Promise<number> {
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
    }

    // Sort by createdAt DESC
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  async completeJob(jobId: number): Promise<void> {
    const now = this.nowMs();
    await this.client.eval(COMPLETE_JOB_SCRIPT, 1, this.prefix, jobId, now);
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

  async cleanupOldJobs(daysToKeep = 30): Promise<number> {
    const cutoffMs = this.nowMs() - daysToKeep * 24 * 60 * 60 * 1000;
    const result = (await this.client.eval(
      CLEANUP_OLD_JOBS_SCRIPT,
      1,
      this.prefix,
      cutoffMs,
    )) as number;
    log(`Deleted ${result} old jobs`);
    return Number(result);
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
