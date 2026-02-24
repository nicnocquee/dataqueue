import { Pool } from 'pg';
import {
  JobOptions,
  JobRecord,
  FailureReason,
  JobEvent,
  JobEventType,
  TagQueryMode,
  JobType,
  CronScheduleRecord,
  CronScheduleStatus,
  EditCronScheduleOptions,
  WaitpointRecord,
  CreateTokenOptions,
  AddJobOptions,
  DatabaseClient,
} from '../types.js';
import { randomUUID } from 'crypto';
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

export class PostgresBackend implements QueueBackend {
  constructor(private pool: Pool) {}

  /** Expose the raw pool for advanced usage. */
  getPool(): Pool {
    return this.pool;
  }

  // ── Events ──────────────────────────────────────────────────────────

  async recordJobEvent(
    jobId: number,
    eventType: JobEventType,
    metadata?: any,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO job_events (job_id, event_type, metadata) VALUES ($1, $2, $3)`,
        [jobId, eventType, metadata ? JSON.stringify(metadata) : null],
      );
    } catch (error) {
      log(`Error recording job event for job ${jobId}: ${error}`);
      // Do not throw, to avoid interfering with main job logic
    } finally {
      client.release();
    }
  }

  async getJobEvents(jobId: number): Promise<JobEvent[]> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        `SELECT id, job_id AS "jobId", event_type AS "eventType", metadata, created_at AS "createdAt" FROM job_events WHERE job_id = $1 ORDER BY created_at ASC`,
        [jobId],
      );
      return res.rows as JobEvent[];
    } finally {
      client.release();
    }
  }

  // ── Job CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a job and return its numeric ID.
   *
   * @param job - Job configuration.
   * @param options - Optional. Pass `{ db }` to run the INSERT on an external
   *   client (e.g., inside a transaction) so the job is part of the caller's
   *   transaction. The event INSERT also uses the same client.
   */
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
    const externalClient = options?.db;
    const client: DatabaseClient =
      externalClient ?? (await this.pool.connect());
    try {
      let result;
      const onConflict = idempotencyKey
        ? `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
        : '';

      if (runAt) {
        result = await client.query(
          `INSERT INTO job_queue 
            (job_type, payload, max_attempts, priority, run_at, timeout_ms, force_kill_on_timeout, tags, idempotency_key, retry_delay, retry_backoff, retry_delay_max, group_id, group_tier) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
           ${onConflict}
           RETURNING id`,
          [
            jobType,
            payload,
            maxAttempts,
            priority,
            runAt,
            timeoutMs ?? null,
            forceKillOnTimeout ?? false,
            tags ?? null,
            idempotencyKey ?? null,
            retryDelay ?? null,
            retryBackoff ?? null,
            retryDelayMax ?? null,
            group?.id ?? null,
            group?.tier ?? null,
          ],
        );
      } else {
        result = await client.query(
          `INSERT INTO job_queue 
            (job_type, payload, max_attempts, priority, timeout_ms, force_kill_on_timeout, tags, idempotency_key, retry_delay, retry_backoff, retry_delay_max, group_id, group_tier) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
           ${onConflict}
           RETURNING id`,
          [
            jobType,
            payload,
            maxAttempts,
            priority,
            timeoutMs ?? null,
            forceKillOnTimeout ?? false,
            tags ?? null,
            idempotencyKey ?? null,
            retryDelay ?? null,
            retryBackoff ?? null,
            retryDelayMax ?? null,
            group?.id ?? null,
            group?.tier ?? null,
          ],
        );
      }

      if (result.rows.length === 0 && idempotencyKey) {
        const existing = await client.query(
          `SELECT id FROM job_queue WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (existing.rows.length > 0) {
          log(
            `Job with idempotency key "${idempotencyKey}" already exists (id: ${existing.rows[0].id}), returning existing job`,
          );
          return existing.rows[0].id;
        }
        throw new Error(
          `Failed to insert job and could not find existing job with idempotency key "${idempotencyKey}"`,
        );
      }

      const jobId = result.rows[0].id;
      log(
        `Added job ${jobId}: payload ${JSON.stringify(payload)}, ${runAt ? `runAt ${runAt.toISOString()}, ` : ''}priority ${priority}, maxAttempts ${maxAttempts}, jobType ${jobType}, tags ${JSON.stringify(tags)}${idempotencyKey ? `, idempotencyKey "${idempotencyKey}"` : ''}`,
      );

      if (externalClient) {
        try {
          await client.query(
            `INSERT INTO job_events (job_id, event_type, metadata) VALUES ($1, $2, $3)`,
            [
              jobId,
              JobEventType.Added,
              JSON.stringify({ jobType, payload, tags, idempotencyKey }),
            ],
          );
        } catch (error) {
          log(`Error recording job event for job ${jobId}: ${error}`);
        }
      } else {
        await this.recordJobEvent(jobId, JobEventType.Added, {
          jobType,
          payload,
          tags,
          idempotencyKey,
        });
      }
      return jobId;
    } catch (error) {
      log(`Error adding job: ${error}`);
      throw error;
    } finally {
      if (!externalClient) (client as any).release();
    }
  }

  /**
   * Insert multiple jobs in a single database round-trip.
   *
   * Uses a multi-row INSERT with ON CONFLICT handling for idempotency keys.
   * Returns IDs in the same order as the input array.
   */
  async addJobs<PayloadMap, T extends JobType<PayloadMap>>(
    jobs: JobOptions<PayloadMap, T>[],
    options?: AddJobOptions,
  ): Promise<number[]> {
    if (jobs.length === 0) return [];

    const externalClient = options?.db;
    const client: DatabaseClient =
      externalClient ?? (await this.pool.connect());
    try {
      const COLS_PER_JOB = 14;
      const valueClauses: string[] = [];
      const params: any[] = [];

      const hasAnyIdempotencyKey = jobs.some((j) => j.idempotencyKey);

      for (let i = 0; i < jobs.length; i++) {
        const {
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
        } = jobs[i];

        const base = i * COLS_PER_JOB;
        valueClauses.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ` +
            `COALESCE($${base + 5}::timestamptz, CURRENT_TIMESTAMP), ` +
            `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, ` +
            `$${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`,
        );
        params.push(
          jobType,
          payload,
          maxAttempts,
          priority,
          runAt,
          timeoutMs ?? null,
          forceKillOnTimeout ?? false,
          tags ?? null,
          idempotencyKey ?? null,
          retryDelay ?? null,
          retryBackoff ?? null,
          retryDelayMax ?? null,
          group?.id ?? null,
          group?.tier ?? null,
        );
      }

      const onConflict = hasAnyIdempotencyKey
        ? `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
        : '';

      const result = await client.query(
        `INSERT INTO job_queue
          (job_type, payload, max_attempts, priority, run_at, timeout_ms, force_kill_on_timeout, tags, idempotency_key, retry_delay, retry_backoff, retry_delay_max, group_id, group_tier)
         VALUES ${valueClauses.join(', ')}
         ${onConflict}
         RETURNING id, idempotency_key`,
        params,
      );

      // Build a map of idempotency_key -> id from returned rows
      const returnedKeyToId = new Map<string, number>();
      const returnedNullKeyIds: number[] = [];
      for (const row of result.rows) {
        if (row.idempotency_key != null) {
          returnedKeyToId.set(row.idempotency_key, row.id);
        } else {
          returnedNullKeyIds.push(row.id);
        }
      }

      // Identify idempotency keys that conflicted (not in RETURNING)
      const missingKeys: string[] = [];
      for (const job of jobs) {
        if (job.idempotencyKey && !returnedKeyToId.has(job.idempotencyKey)) {
          missingKeys.push(job.idempotencyKey);
        }
      }

      // Batch-fetch existing IDs for conflicted keys
      if (missingKeys.length > 0) {
        const existing = await client.query(
          `SELECT id, idempotency_key FROM job_queue WHERE idempotency_key = ANY($1)`,
          [missingKeys],
        );
        for (const row of existing.rows) {
          returnedKeyToId.set(row.idempotency_key, row.id);
        }
      }

      // Assemble result array in input order
      let nullKeyIdx = 0;
      const ids: number[] = [];
      for (const job of jobs) {
        if (job.idempotencyKey) {
          const id = returnedKeyToId.get(job.idempotencyKey);
          if (id === undefined) {
            throw new Error(
              `Failed to resolve job ID for idempotency key "${job.idempotencyKey}"`,
            );
          }
          ids.push(id);
        } else {
          ids.push(returnedNullKeyIds[nullKeyIdx++]);
        }
      }

      log(`Batch-inserted ${jobs.length} jobs, IDs: [${ids.join(', ')}]`);

      // Record 'added' events — only for newly inserted jobs
      const newJobEvents: {
        jobId: number;
        eventType: JobEventType;
        metadata?: any;
      }[] = [];
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const wasInserted =
          !job.idempotencyKey || !missingKeys.includes(job.idempotencyKey);
        if (wasInserted) {
          newJobEvents.push({
            jobId: ids[i],
            eventType: JobEventType.Added,
            metadata: {
              jobType: job.jobType,
              payload: job.payload,
              tags: job.tags,
              idempotencyKey: job.idempotencyKey,
            },
          });
        }
      }

      if (newJobEvents.length > 0) {
        if (externalClient) {
          // Record events on the same transaction client
          const evtValues: string[] = [];
          const evtParams: any[] = [];
          let evtIdx = 1;
          for (const evt of newJobEvents) {
            evtValues.push(`($${evtIdx++}, $${evtIdx++}, $${evtIdx++})`);
            evtParams.push(
              evt.jobId,
              evt.eventType,
              evt.metadata ? JSON.stringify(evt.metadata) : null,
            );
          }
          try {
            await client.query(
              `INSERT INTO job_events (job_id, event_type, metadata) VALUES ${evtValues.join(', ')}`,
              evtParams,
            );
          } catch (error) {
            log(`Error recording batch job events: ${error}`);
          }
        } else {
          await this.recordJobEventsBatch(newJobEvents);
        }
      }

      return ids;
    } catch (error) {
      log(`Error batch-inserting jobs: ${error}`);
      throw error;
    } finally {
      if (!externalClient) (client as any).release();
    }
  }

  async getJob<PayloadMap, T extends JobType<PayloadMap>>(
    id: number,
  ): Promise<JobRecord<PayloadMap, T> | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output FROM job_queue WHERE id = $1`,
        [id],
      );

      if (result.rows.length === 0) {
        log(`Job ${id} not found`);
        return null;
      }

      log(`Found job ${id}`);
      const job = result.rows[0] as JobRecord<PayloadMap, T>;
      return {
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
        failureReason: job.failureReason,
      };
    } catch (error) {
      log(`Error getting job ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async getJobsByStatus<PayloadMap, T extends JobType<PayloadMap>>(
    status: string,
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [status, limit, offset],
      );
      log(`Found ${result.rows.length} jobs by status ${status}`);
      return result.rows.map((job) => ({
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
        failureReason: job.failureReason,
      }));
    } catch (error) {
      log(`Error getting jobs by status ${status}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllJobs<PayloadMap, T extends JobType<PayloadMap>>(
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output FROM job_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      log(`Found ${result.rows.length} jobs (all)`);
      return result.rows.map((job) => ({
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
      }));
    } catch (error) {
      log(`Error getting all jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async getJobs<PayloadMap, T extends JobType<PayloadMap>>(
    filters?: JobFilters,
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output FROM job_queue`;
      const params: any[] = [];
      const where: string[] = [];
      let paramIdx = 1;
      if (filters) {
        if (filters.jobType) {
          where.push(`job_type = $${paramIdx++}`);
          params.push(filters.jobType);
        }
        if (filters.priority !== undefined) {
          where.push(`priority = $${paramIdx++}`);
          params.push(filters.priority);
        }
        if (filters.runAt) {
          if (filters.runAt instanceof Date) {
            where.push(`run_at = $${paramIdx++}`);
            params.push(filters.runAt);
          } else if (
            typeof filters.runAt === 'object' &&
            (filters.runAt.gt !== undefined ||
              filters.runAt.gte !== undefined ||
              filters.runAt.lt !== undefined ||
              filters.runAt.lte !== undefined ||
              filters.runAt.eq !== undefined)
          ) {
            const ops = filters.runAt as {
              gt?: Date;
              gte?: Date;
              lt?: Date;
              lte?: Date;
              eq?: Date;
            };
            if (ops.gt) {
              where.push(`run_at > $${paramIdx++}`);
              params.push(ops.gt);
            }
            if (ops.gte) {
              where.push(`run_at >= $${paramIdx++}`);
              params.push(ops.gte);
            }
            if (ops.lt) {
              where.push(`run_at < $${paramIdx++}`);
              params.push(ops.lt);
            }
            if (ops.lte) {
              where.push(`run_at <= $${paramIdx++}`);
              params.push(ops.lte);
            }
            if (ops.eq) {
              where.push(`run_at = $${paramIdx++}`);
              params.push(ops.eq);
            }
          }
        }
        if (
          filters.tags &&
          filters.tags.values &&
          filters.tags.values.length > 0
        ) {
          const mode = filters.tags.mode || 'all';
          const tagValues = filters.tags.values;
          switch (mode) {
            case 'exact':
              where.push(`tags = $${paramIdx++}`);
              params.push(tagValues);
              break;
            case 'all':
              where.push(`tags @> $${paramIdx++}`);
              params.push(tagValues);
              break;
            case 'any':
              where.push(`tags && $${paramIdx++}`);
              params.push(tagValues);
              break;
            case 'none':
              where.push(`NOT (tags && $${paramIdx++})`);
              params.push(tagValues);
              break;
            default:
              where.push(`tags @> $${paramIdx++}`);
              params.push(tagValues);
          }
        }
        // Keyset pagination: use cursor (id < cursor) instead of OFFSET
        if (filters.cursor !== undefined) {
          where.push(`id < $${paramIdx++}`);
          params.push(filters.cursor);
        }
      }
      if (where.length > 0) {
        query += ` WHERE ${where.join(' AND ')}`;
      }
      paramIdx = params.length + 1;
      // Use ORDER BY id DESC for consistent keyset pagination
      query += ` ORDER BY id DESC LIMIT $${paramIdx++}`;
      // Only apply OFFSET when cursor is not used
      if (!filters?.cursor) {
        query += ` OFFSET $${paramIdx}`;
        params.push(limit, offset);
      } else {
        params.push(limit);
      }
      const result = await client.query(query, params);
      log(`Found ${result.rows.length} jobs`);
      return result.rows.map((job) => ({
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
        failureReason: job.failureReason,
      }));
    } catch (error) {
      log(`Error getting jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async getJobsByTags<PayloadMap, T extends JobType<PayloadMap>>(
    tags: string[],
    mode: TagQueryMode = 'all',
    limit = 100,
    offset = 0,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output
         FROM job_queue`;
      let params: any[] = [];
      switch (mode) {
        case 'exact':
          query += ' WHERE tags = $1';
          params = [tags];
          break;
        case 'all':
          query += ' WHERE tags @> $1';
          params = [tags];
          break;
        case 'any':
          query += ' WHERE tags && $1';
          params = [tags];
          break;
        case 'none':
          query += ' WHERE NOT (tags && $1)';
          params = [tags];
          break;
        default:
          query += ' WHERE tags @> $1';
          params = [tags];
      }
      query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(limit, offset);
      const result = await client.query(query, params);
      log(
        `Found ${result.rows.length} jobs by tags ${JSON.stringify(tags)} (mode: ${mode})`,
      );
      return result.rows.map((job) => ({
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
        failureReason: job.failureReason,
      }));
    } catch (error) {
      log(
        `Error getting jobs by tags ${JSON.stringify(tags)} (mode: ${mode}): ${error}`,
      );
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Processing lifecycle ──────────────────────────────────────────────

  async getNextBatch<PayloadMap, T extends JobType<PayloadMap>>(
    workerId: string,
    batchSize = 10,
    jobType?: string | string[],
    groupConcurrency?: number,
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let jobTypeFilter = '';
      const params: any[] = [workerId, batchSize];
      if (jobType) {
        if (Array.isArray(jobType)) {
          jobTypeFilter = ` AND candidate.job_type = ANY($3)`;
          params.push(jobType);
        } else {
          jobTypeFilter = ` AND candidate.job_type = $3`;
          params.push(jobType);
        }
      }

      let result;
      if (groupConcurrency === undefined) {
        result = await client.query(
          `
          UPDATE job_queue
          SET status = 'processing', 
              locked_at = NOW(), 
              locked_by = $1,
              attempts = CASE WHEN status = 'waiting' THEN attempts ELSE attempts + 1 END,
              updated_at = NOW(),
              pending_reason = NULL,
              started_at = COALESCE(started_at, NOW()),
              last_retried_at = CASE WHEN status != 'waiting' AND attempts > 0 THEN NOW() ELSE last_retried_at END,
              wait_until = NULL
          WHERE id IN (
            SELECT id FROM job_queue candidate
            WHERE (
              (
                (candidate.status = 'pending' OR (candidate.status = 'failed' AND candidate.next_attempt_at <= NOW()))
                AND (candidate.attempts < candidate.max_attempts)
                AND candidate.run_at <= NOW()
              )
              OR (
                candidate.status = 'waiting'
                AND candidate.wait_until IS NOT NULL
                AND candidate.wait_until <= NOW()
                AND candidate.wait_token_id IS NULL
              )
            )
            ${jobTypeFilter}
            ORDER BY candidate.priority DESC, candidate.created_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output
        `,
          params,
        );
      } else {
        const constrainedParams = [...params, groupConcurrency];
        const groupConcurrencyParamIndex = constrainedParams.length;
        result = await client.query(
          `
          WITH eligible AS (
            SELECT candidate.id, candidate.group_id, candidate.priority, candidate.created_at
            FROM job_queue candidate
            WHERE (
              (
                (candidate.status = 'pending' OR (candidate.status = 'failed' AND candidate.next_attempt_at <= NOW()))
                AND (candidate.attempts < candidate.max_attempts)
                AND candidate.run_at <= NOW()
              )
              OR (
                candidate.status = 'waiting'
                AND candidate.wait_until IS NOT NULL
                AND candidate.wait_until <= NOW()
                AND candidate.wait_token_id IS NULL
              )
            )
            ${jobTypeFilter}
            FOR UPDATE SKIP LOCKED
          ),
          ranked AS (
            SELECT
              eligible.id,
              eligible.group_id,
              eligible.priority,
              eligible.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY eligible.group_id
                ORDER BY eligible.priority DESC, eligible.created_at ASC
              ) AS group_rank,
              COALESCE((
                SELECT COUNT(*)
                FROM job_queue processing_jobs
                WHERE processing_jobs.status = 'processing'
                  AND processing_jobs.group_id = eligible.group_id
              ), 0) AS active_group_count
            FROM eligible
          ),
          selected AS (
            SELECT ranked.id
            FROM ranked
            WHERE ranked.group_id IS NULL
              OR (
                ranked.active_group_count < $${groupConcurrencyParamIndex}
                AND ranked.group_rank <= ($${groupConcurrencyParamIndex} - ranked.active_group_count)
              )
            ORDER BY ranked.priority DESC, ranked.created_at ASC
            LIMIT $2
          )
          UPDATE job_queue
          SET status = 'processing', 
              locked_at = NOW(), 
              locked_by = $1,
              attempts = CASE WHEN status = 'waiting' THEN attempts ELSE attempts + 1 END,
              updated_at = NOW(),
              pending_reason = NULL,
              started_at = COALESCE(started_at, NOW()),
              last_retried_at = CASE WHEN status != 'waiting' AND attempts > 0 THEN NOW() ELSE last_retried_at END,
              wait_until = NULL
          WHERE id IN (SELECT id FROM selected)
          RETURNING id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData", progress, retry_delay AS "retryDelay", retry_backoff AS "retryBackoff", retry_delay_max AS "retryDelayMax", group_id AS "groupId", group_tier AS "groupTier", output
        `,
          constrainedParams,
        );
      }

      log(`Found ${result.rows.length} jobs to process`);
      await client.query('COMMIT');

      // Batch-insert processing events in a single query
      if (result.rows.length > 0) {
        await this.recordJobEventsBatch(
          result.rows.map((row) => ({
            jobId: row.id,
            eventType: JobEventType.Processing,
          })),
        );
      }

      return result.rows.map((job) => ({
        ...job,
        payload: job.payload,
        timeoutMs: job.timeoutMs,
        forceKillOnTimeout: job.forceKillOnTimeout,
      }));
    } catch (error) {
      log(`Error getting next batch: ${error}`);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(jobId: number, output?: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      const outputJson = output !== undefined ? JSON.stringify(output) : null;
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'completed', updated_at = NOW(), completed_at = NOW(),
            step_data = NULL, wait_until = NULL, wait_token_id = NULL,
            output = COALESCE($2::jsonb, output)
        WHERE id = $1 AND status = 'processing'
      `,
        [jobId, outputJson],
      );
      if (result.rowCount === 0) {
        log(
          `Job ${jobId} could not be completed (not in processing state or does not exist)`,
        );
      }
      await this.recordJobEvent(jobId, JobEventType.Completed);
      log(`Completed job ${jobId}`);
    } catch (error) {
      log(`Error completing job ${jobId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async failJob(
    jobId: number,
    error: Error,
    failureReason?: FailureReason,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'failed', 
            updated_at = NOW(),
            next_attempt_at = CASE
              WHEN attempts >= max_attempts THEN NULL
              WHEN retry_delay IS NULL AND retry_backoff IS NULL AND retry_delay_max IS NULL
                THEN NOW() + (POWER(2, attempts) * INTERVAL '1 minute')
              WHEN COALESCE(retry_backoff, true) = true
                THEN NOW() + (LEAST(
                  COALESCE(retry_delay_max, 2147483647),
                  COALESCE(retry_delay, 60) * POWER(2, attempts)
                ) * (0.5 + 0.5 * random()) * INTERVAL '1 second')
              ELSE
                NOW() + (COALESCE(retry_delay, 60) * INTERVAL '1 second')
            END,
            error_history = COALESCE(error_history, '[]'::jsonb) || $2::jsonb,
            failure_reason = $3,
            last_failed_at = NOW()
        WHERE id = $1 AND status IN ('processing', 'pending')
      `,
        [
          jobId,
          JSON.stringify([
            {
              message: error.message || String(error),
              timestamp: new Date().toISOString(),
            },
          ]),
          failureReason ?? null,
        ],
      );
      if (result.rowCount === 0) {
        log(
          `Job ${jobId} could not be failed (not in processing/pending state or does not exist)`,
        );
      }
      await this.recordJobEvent(jobId, JobEventType.Failed, {
        message: error.message || String(error),
        failureReason,
      });
      log(`Failed job ${jobId}`);
    } catch (err) {
      log(`Error failing job ${jobId}: ${err}`);
      throw err;
    } finally {
      client.release();
    }
  }

  async prolongJob(jobId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        UPDATE job_queue
        SET locked_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'processing'
      `,
        [jobId],
      );
      await this.recordJobEvent(jobId, JobEventType.Prolonged);
      log(`Prolonged job ${jobId}`);
    } catch (error) {
      log(`Error prolonging job ${jobId}: ${error}`);
      // Do not throw -- prolong is best-effort
    } finally {
      client.release();
    }
  }

  // ── Progress ──────────────────────────────────────────────────────────

  async updateProgress(jobId: number, progress: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE job_queue SET progress = $2, updated_at = NOW() WHERE id = $1`,
        [jobId, progress],
      );
      log(`Updated progress for job ${jobId}: ${progress}%`);
    } catch (error) {
      log(`Error updating progress for job ${jobId}: ${error}`);
      // Best-effort: do not throw to avoid killing the running handler
    } finally {
      client.release();
    }
  }

  // ── Output ────────────────────────────────────────────────────────────

  async updateOutput(jobId: number, output: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE job_queue SET output = $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [jobId, JSON.stringify(output)],
      );
      log(`Updated output for job ${jobId}`);
    } catch (error) {
      log(`Error updating output for job ${jobId}: ${error}`);
    } finally {
      client.release();
    }
  }

  // ── Job management ────────────────────────────────────────────────────

  async retryJob(jobId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'pending', 
            updated_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            next_attempt_at = NOW(),
            last_retried_at = NOW()
        WHERE id = $1 AND status IN ('failed', 'processing')
      `,
        [jobId],
      );
      if (result.rowCount === 0) {
        log(
          `Job ${jobId} could not be retried (not in failed/processing state or does not exist)`,
        );
      }
      await this.recordJobEvent(jobId, JobEventType.Retried);
      log(`Retried job ${jobId}`);
    } catch (error) {
      log(`Error retrying job ${jobId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelJob(jobId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        UPDATE job_queue
        SET status = 'cancelled', updated_at = NOW(), last_cancelled_at = NOW(),
            wait_until = NULL, wait_token_id = NULL
        WHERE id = $1 AND status IN ('pending', 'waiting')
      `,
        [jobId],
      );
      await this.recordJobEvent(jobId, JobEventType.Cancelled);
      log(`Cancelled job ${jobId}`);
    } catch (error) {
      log(`Error cancelling job ${jobId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelAllUpcomingJobs(filters?: JobFilters): Promise<number> {
    const client = await this.pool.connect();
    try {
      let query = `
        UPDATE job_queue
        SET status = 'cancelled', updated_at = NOW()
        WHERE status = 'pending'`;
      const params: any[] = [];
      let paramIdx = 1;
      if (filters) {
        if (filters.jobType) {
          query += ` AND job_type = $${paramIdx++}`;
          params.push(filters.jobType);
        }
        if (filters.priority !== undefined) {
          query += ` AND priority = $${paramIdx++}`;
          params.push(filters.priority);
        }
        if (filters.runAt) {
          if (filters.runAt instanceof Date) {
            query += ` AND run_at = $${paramIdx++}`;
            params.push(filters.runAt);
          } else if (typeof filters.runAt === 'object') {
            const ops = filters.runAt;
            if (ops.gt) {
              query += ` AND run_at > $${paramIdx++}`;
              params.push(ops.gt);
            }
            if (ops.gte) {
              query += ` AND run_at >= $${paramIdx++}`;
              params.push(ops.gte);
            }
            if (ops.lt) {
              query += ` AND run_at < $${paramIdx++}`;
              params.push(ops.lt);
            }
            if (ops.lte) {
              query += ` AND run_at <= $${paramIdx++}`;
              params.push(ops.lte);
            }
            if (ops.eq) {
              query += ` AND run_at = $${paramIdx++}`;
              params.push(ops.eq);
            }
          }
        }
        if (
          filters.tags &&
          filters.tags.values &&
          filters.tags.values.length > 0
        ) {
          const mode = filters.tags.mode || 'all';
          const tagValues = filters.tags.values;
          switch (mode) {
            case 'exact':
              query += ` AND tags = $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'all':
              query += ` AND tags @> $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'any':
              query += ` AND tags && $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'none':
              query += ` AND NOT (tags && $${paramIdx++})`;
              params.push(tagValues);
              break;
            default:
              query += ` AND tags @> $${paramIdx++}`;
              params.push(tagValues);
          }
        }
      }
      query += '\nRETURNING id';
      const result = await client.query(query, params);
      log(`Cancelled ${result.rowCount} jobs`);
      return result.rowCount || 0;
    } catch (error) {
      log(`Error cancelling upcoming jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async editJob(jobId: number, updates: JobUpdates): Promise<void> {
    const client = await this.pool.connect();
    try {
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (updates.payload !== undefined) {
        updateFields.push(`payload = $${paramIdx++}`);
        params.push(updates.payload);
      }
      if (updates.maxAttempts !== undefined) {
        updateFields.push(`max_attempts = $${paramIdx++}`);
        params.push(updates.maxAttempts);
      }
      if (updates.priority !== undefined) {
        updateFields.push(`priority = $${paramIdx++}`);
        params.push(updates.priority);
      }
      if (updates.runAt !== undefined) {
        if (updates.runAt === null) {
          updateFields.push(`run_at = NOW()`);
        } else {
          updateFields.push(`run_at = $${paramIdx++}`);
          params.push(updates.runAt);
        }
      }
      if (updates.timeoutMs !== undefined) {
        updateFields.push(`timeout_ms = $${paramIdx++}`);
        params.push(updates.timeoutMs ?? null);
      }
      if (updates.tags !== undefined) {
        updateFields.push(`tags = $${paramIdx++}`);
        params.push(updates.tags ?? null);
      }
      if (updates.retryDelay !== undefined) {
        updateFields.push(`retry_delay = $${paramIdx++}`);
        params.push(updates.retryDelay ?? null);
      }
      if (updates.retryBackoff !== undefined) {
        updateFields.push(`retry_backoff = $${paramIdx++}`);
        params.push(updates.retryBackoff ?? null);
      }
      if (updates.retryDelayMax !== undefined) {
        updateFields.push(`retry_delay_max = $${paramIdx++}`);
        params.push(updates.retryDelayMax ?? null);
      }

      if (updateFields.length === 0) {
        log(`No fields to update for job ${jobId}`);
        return;
      }

      updateFields.push(`updated_at = NOW()`);
      params.push(jobId);

      const query = `
        UPDATE job_queue
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIdx} AND status = 'pending'
      `;

      await client.query(query, params);

      const metadata: any = {};
      if (updates.payload !== undefined) metadata.payload = updates.payload;
      if (updates.maxAttempts !== undefined)
        metadata.maxAttempts = updates.maxAttempts;
      if (updates.priority !== undefined) metadata.priority = updates.priority;
      if (updates.runAt !== undefined) metadata.runAt = updates.runAt;
      if (updates.timeoutMs !== undefined)
        metadata.timeoutMs = updates.timeoutMs;
      if (updates.tags !== undefined) metadata.tags = updates.tags;
      if (updates.retryDelay !== undefined)
        metadata.retryDelay = updates.retryDelay;
      if (updates.retryBackoff !== undefined)
        metadata.retryBackoff = updates.retryBackoff;
      if (updates.retryDelayMax !== undefined)
        metadata.retryDelayMax = updates.retryDelayMax;

      await this.recordJobEvent(jobId, JobEventType.Edited, metadata);
      log(`Edited job ${jobId}: ${JSON.stringify(metadata)}`);
    } catch (error) {
      log(`Error editing job ${jobId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async editAllPendingJobs(
    filters: JobFilters | undefined = undefined,
    updates: JobUpdates,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (updates.payload !== undefined) {
        updateFields.push(`payload = $${paramIdx++}`);
        params.push(updates.payload);
      }
      if (updates.maxAttempts !== undefined) {
        updateFields.push(`max_attempts = $${paramIdx++}`);
        params.push(updates.maxAttempts);
      }
      if (updates.priority !== undefined) {
        updateFields.push(`priority = $${paramIdx++}`);
        params.push(updates.priority);
      }
      if (updates.runAt !== undefined) {
        if (updates.runAt === null) {
          updateFields.push(`run_at = NOW()`);
        } else {
          updateFields.push(`run_at = $${paramIdx++}`);
          params.push(updates.runAt);
        }
      }
      if (updates.timeoutMs !== undefined) {
        updateFields.push(`timeout_ms = $${paramIdx++}`);
        params.push(updates.timeoutMs ?? null);
      }
      if (updates.tags !== undefined) {
        updateFields.push(`tags = $${paramIdx++}`);
        params.push(updates.tags ?? null);
      }
      if (updates.retryDelay !== undefined) {
        updateFields.push(`retry_delay = $${paramIdx++}`);
        params.push(updates.retryDelay ?? null);
      }
      if (updates.retryBackoff !== undefined) {
        updateFields.push(`retry_backoff = $${paramIdx++}`);
        params.push(updates.retryBackoff ?? null);
      }
      if (updates.retryDelayMax !== undefined) {
        updateFields.push(`retry_delay_max = $${paramIdx++}`);
        params.push(updates.retryDelayMax ?? null);
      }

      if (updateFields.length === 0) {
        log(`No fields to update for batch edit`);
        return 0;
      }

      updateFields.push(`updated_at = NOW()`);

      let query = `
        UPDATE job_queue
        SET ${updateFields.join(', ')}
        WHERE status = 'pending'`;

      if (filters) {
        if (filters.jobType) {
          query += ` AND job_type = $${paramIdx++}`;
          params.push(filters.jobType);
        }
        if (filters.priority !== undefined) {
          query += ` AND priority = $${paramIdx++}`;
          params.push(filters.priority);
        }
        if (filters.runAt) {
          if (filters.runAt instanceof Date) {
            query += ` AND run_at = $${paramIdx++}`;
            params.push(filters.runAt);
          } else if (typeof filters.runAt === 'object') {
            const ops = filters.runAt;
            if (ops.gt) {
              query += ` AND run_at > $${paramIdx++}`;
              params.push(ops.gt);
            }
            if (ops.gte) {
              query += ` AND run_at >= $${paramIdx++}`;
              params.push(ops.gte);
            }
            if (ops.lt) {
              query += ` AND run_at < $${paramIdx++}`;
              params.push(ops.lt);
            }
            if (ops.lte) {
              query += ` AND run_at <= $${paramIdx++}`;
              params.push(ops.lte);
            }
            if (ops.eq) {
              query += ` AND run_at = $${paramIdx++}`;
              params.push(ops.eq);
            }
          }
        }
        if (
          filters.tags &&
          filters.tags.values &&
          filters.tags.values.length > 0
        ) {
          const mode = filters.tags.mode || 'all';
          const tagValues = filters.tags.values;
          switch (mode) {
            case 'exact':
              query += ` AND tags = $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'all':
              query += ` AND tags @> $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'any':
              query += ` AND tags && $${paramIdx++}`;
              params.push(tagValues);
              break;
            case 'none':
              query += ` AND NOT (tags && $${paramIdx++})`;
              params.push(tagValues);
              break;
            default:
              query += ` AND tags @> $${paramIdx++}`;
              params.push(tagValues);
          }
        }
      }
      query += '\nRETURNING id';

      const result = await client.query(query, params);
      const editedCount = result.rowCount || 0;

      const metadata: any = {};
      if (updates.payload !== undefined) metadata.payload = updates.payload;
      if (updates.maxAttempts !== undefined)
        metadata.maxAttempts = updates.maxAttempts;
      if (updates.priority !== undefined) metadata.priority = updates.priority;
      if (updates.runAt !== undefined) metadata.runAt = updates.runAt;
      if (updates.timeoutMs !== undefined)
        metadata.timeoutMs = updates.timeoutMs;
      if (updates.tags !== undefined) metadata.tags = updates.tags;

      for (const row of result.rows) {
        await this.recordJobEvent(row.id, JobEventType.Edited, metadata);
      }

      log(`Edited ${editedCount} pending jobs: ${JSON.stringify(metadata)}`);
      return editedCount;
    } catch (error) {
      log(`Error editing pending jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete completed jobs older than the given number of days.
   * Deletes in batches of 1000 to avoid long-running transactions
   * and excessive WAL bloat at scale.
   *
   * @param daysToKeep - Number of days to retain completed jobs (default 30).
   * @param batchSize - Number of rows to delete per batch (default 1000).
   * @returns Total number of deleted jobs.
   */
  async cleanupOldJobs(daysToKeep = 30, batchSize = 1000): Promise<number> {
    let totalDeleted = 0;

    try {
      let deletedInBatch: number;
      do {
        const client = await this.pool.connect();
        try {
          const result = await client.query(
            `
            DELETE FROM job_queue
            WHERE id IN (
              SELECT id FROM job_queue
              WHERE status = 'completed'
              AND updated_at < NOW() - INTERVAL '1 day' * $1::int
              LIMIT $2
            )
          `,
            [daysToKeep, batchSize],
          );
          deletedInBatch = result.rowCount || 0;
          totalDeleted += deletedInBatch;
        } finally {
          client.release();
        }
      } while (deletedInBatch === batchSize);

      log(`Deleted ${totalDeleted} old jobs`);
      return totalDeleted;
    } catch (error) {
      log(`Error cleaning up old jobs: ${error}`);
      throw error;
    }
  }

  /**
   * Delete job events older than the given number of days.
   * Deletes in batches of 1000 to avoid long-running transactions
   * and excessive WAL bloat at scale.
   *
   * @param daysToKeep - Number of days to retain events (default 30).
   * @param batchSize - Number of rows to delete per batch (default 1000).
   * @returns Total number of deleted events.
   */
  async cleanupOldJobEvents(
    daysToKeep = 30,
    batchSize = 1000,
  ): Promise<number> {
    let totalDeleted = 0;

    try {
      let deletedInBatch: number;
      do {
        const client = await this.pool.connect();
        try {
          const result = await client.query(
            `
            DELETE FROM job_events
            WHERE id IN (
              SELECT id FROM job_events
              WHERE created_at < NOW() - INTERVAL '1 day' * $1::int
              LIMIT $2
            )
          `,
            [daysToKeep, batchSize],
          );
          deletedInBatch = result.rowCount || 0;
          totalDeleted += deletedInBatch;
        } finally {
          client.release();
        }
      } while (deletedInBatch === batchSize);

      log(`Deleted ${totalDeleted} old job events`);
      return totalDeleted;
    } catch (error) {
      log(`Error cleaning up old job events: ${error}`);
      throw error;
    }
  }

  async reclaimStuckJobs(maxProcessingTimeMinutes = 10): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = NOW()
        WHERE status = 'processing'
          AND locked_at < NOW() - GREATEST(
            INTERVAL '1 minute' * $1::int,
            INTERVAL '1 millisecond' * COALESCE(timeout_ms, 0)
          )
        RETURNING id
        `,
        [maxProcessingTimeMinutes],
      );
      log(`Reclaimed ${result.rowCount} stuck jobs`);
      return result.rowCount || 0;
    } catch (error) {
      log(`Error reclaiming stuck jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /**
   * Batch-insert multiple job events in a single query.
   * More efficient than individual recordJobEvent calls.
   */
  private async recordJobEventsBatch(
    events: { jobId: number; eventType: JobEventType; metadata?: any }[],
  ): Promise<void> {
    if (events.length === 0) return;
    const client = await this.pool.connect();
    try {
      const values: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;
      for (const event of events) {
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(
          event.jobId,
          event.eventType,
          event.metadata ? JSON.stringify(event.metadata) : null,
        );
      }
      await client.query(
        `INSERT INTO job_events (job_id, event_type, metadata) VALUES ${values.join(', ')}`,
        params,
      );
    } catch (error) {
      log(`Error recording batch job events: ${error}`);
      // Do not throw, to avoid interfering with main job logic
    } finally {
      client.release();
    }
  }

  // ── Cron schedules ──────────────────────────────────────────────────

  /** Create a cron schedule and return its ID. */
  async addCronSchedule(input: CronScheduleInput): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO cron_schedules
          (schedule_name, cron_expression, job_type, payload, max_attempts,
           priority, timeout_ms, force_kill_on_timeout, tags, timezone,
           allow_overlap, next_run_at, retry_delay, retry_backoff, retry_delay_max)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          input.scheduleName,
          input.cronExpression,
          input.jobType,
          input.payload,
          input.maxAttempts,
          input.priority,
          input.timeoutMs,
          input.forceKillOnTimeout,
          input.tags ?? null,
          input.timezone,
          input.allowOverlap,
          input.nextRunAt,
          input.retryDelay,
          input.retryBackoff,
          input.retryDelayMax,
        ],
      );
      const id = result.rows[0].id;
      log(`Added cron schedule ${id}: "${input.scheduleName}"`);
      return id;
    } catch (error: any) {
      // Unique constraint violation on schedule_name
      if (error?.code === '23505') {
        throw new Error(
          `Cron schedule with name "${input.scheduleName}" already exists`,
        );
      }
      log(`Error adding cron schedule: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Get a cron schedule by ID. */
  async getCronSchedule(id: number): Promise<CronScheduleRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, schedule_name AS "scheduleName", cron_expression AS "cronExpression",
                job_type AS "jobType", payload, max_attempts AS "maxAttempts",
                priority, timeout_ms AS "timeoutMs",
                force_kill_on_timeout AS "forceKillOnTimeout", tags,
                timezone, allow_overlap AS "allowOverlap", status,
                last_enqueued_at AS "lastEnqueuedAt", last_job_id AS "lastJobId",
                next_run_at AS "nextRunAt",
                created_at AS "createdAt", updated_at AS "updatedAt",
                retry_delay AS "retryDelay", retry_backoff AS "retryBackoff",
                retry_delay_max AS "retryDelayMax"
         FROM cron_schedules WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) return null;
      return result.rows[0] as CronScheduleRecord;
    } catch (error) {
      log(`Error getting cron schedule ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Get a cron schedule by its unique name. */
  async getCronScheduleByName(
    name: string,
  ): Promise<CronScheduleRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, schedule_name AS "scheduleName", cron_expression AS "cronExpression",
                job_type AS "jobType", payload, max_attempts AS "maxAttempts",
                priority, timeout_ms AS "timeoutMs",
                force_kill_on_timeout AS "forceKillOnTimeout", tags,
                timezone, allow_overlap AS "allowOverlap", status,
                last_enqueued_at AS "lastEnqueuedAt", last_job_id AS "lastJobId",
                next_run_at AS "nextRunAt",
                created_at AS "createdAt", updated_at AS "updatedAt",
                retry_delay AS "retryDelay", retry_backoff AS "retryBackoff",
                retry_delay_max AS "retryDelayMax"
         FROM cron_schedules WHERE schedule_name = $1`,
        [name],
      );
      if (result.rows.length === 0) return null;
      return result.rows[0] as CronScheduleRecord;
    } catch (error) {
      log(`Error getting cron schedule by name "${name}": ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** List cron schedules, optionally filtered by status. */
  async listCronSchedules(
    status?: CronScheduleStatus,
  ): Promise<CronScheduleRecord[]> {
    const client = await this.pool.connect();
    try {
      let query = `SELECT id, schedule_name AS "scheduleName", cron_expression AS "cronExpression",
                job_type AS "jobType", payload, max_attempts AS "maxAttempts",
                priority, timeout_ms AS "timeoutMs",
                force_kill_on_timeout AS "forceKillOnTimeout", tags,
                timezone, allow_overlap AS "allowOverlap", status,
                last_enqueued_at AS "lastEnqueuedAt", last_job_id AS "lastJobId",
                next_run_at AS "nextRunAt",
                created_at AS "createdAt", updated_at AS "updatedAt",
                retry_delay AS "retryDelay", retry_backoff AS "retryBackoff",
                retry_delay_max AS "retryDelayMax"
         FROM cron_schedules`;
      const params: any[] = [];
      if (status) {
        query += ` WHERE status = $1`;
        params.push(status);
      }
      query += ` ORDER BY created_at ASC`;
      const result = await client.query(query, params);
      return result.rows as CronScheduleRecord[];
    } catch (error) {
      log(`Error listing cron schedules: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Delete a cron schedule by ID. */
  async removeCronSchedule(id: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`DELETE FROM cron_schedules WHERE id = $1`, [id]);
      log(`Removed cron schedule ${id}`);
    } catch (error) {
      log(`Error removing cron schedule ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Pause a cron schedule. */
  async pauseCronSchedule(id: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE cron_schedules SET status = 'paused', updated_at = NOW() WHERE id = $1`,
        [id],
      );
      log(`Paused cron schedule ${id}`);
    } catch (error) {
      log(`Error pausing cron schedule ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Resume a paused cron schedule. */
  async resumeCronSchedule(id: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE cron_schedules SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [id],
      );
      log(`Resumed cron schedule ${id}`);
    } catch (error) {
      log(`Error resuming cron schedule ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Edit a cron schedule. */
  async editCronSchedule(
    id: number,
    updates: EditCronScheduleOptions,
    nextRunAt?: Date | null,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (updates.cronExpression !== undefined) {
        updateFields.push(`cron_expression = $${paramIdx++}`);
        params.push(updates.cronExpression);
      }
      if (updates.payload !== undefined) {
        updateFields.push(`payload = $${paramIdx++}`);
        params.push(updates.payload);
      }
      if (updates.maxAttempts !== undefined) {
        updateFields.push(`max_attempts = $${paramIdx++}`);
        params.push(updates.maxAttempts);
      }
      if (updates.priority !== undefined) {
        updateFields.push(`priority = $${paramIdx++}`);
        params.push(updates.priority);
      }
      if (updates.timeoutMs !== undefined) {
        updateFields.push(`timeout_ms = $${paramIdx++}`);
        params.push(updates.timeoutMs);
      }
      if (updates.forceKillOnTimeout !== undefined) {
        updateFields.push(`force_kill_on_timeout = $${paramIdx++}`);
        params.push(updates.forceKillOnTimeout);
      }
      if (updates.tags !== undefined) {
        updateFields.push(`tags = $${paramIdx++}`);
        params.push(updates.tags);
      }
      if (updates.timezone !== undefined) {
        updateFields.push(`timezone = $${paramIdx++}`);
        params.push(updates.timezone);
      }
      if (updates.allowOverlap !== undefined) {
        updateFields.push(`allow_overlap = $${paramIdx++}`);
        params.push(updates.allowOverlap);
      }
      if (updates.retryDelay !== undefined) {
        updateFields.push(`retry_delay = $${paramIdx++}`);
        params.push(updates.retryDelay);
      }
      if (updates.retryBackoff !== undefined) {
        updateFields.push(`retry_backoff = $${paramIdx++}`);
        params.push(updates.retryBackoff);
      }
      if (updates.retryDelayMax !== undefined) {
        updateFields.push(`retry_delay_max = $${paramIdx++}`);
        params.push(updates.retryDelayMax);
      }
      if (nextRunAt !== undefined) {
        updateFields.push(`next_run_at = $${paramIdx++}`);
        params.push(nextRunAt);
      }

      if (updateFields.length === 0) {
        log(`No fields to update for cron schedule ${id}`);
        return;
      }

      updateFields.push(`updated_at = NOW()`);
      params.push(id);

      const query = `UPDATE cron_schedules SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`;
      await client.query(query, params);
      log(`Edited cron schedule ${id}`);
    } catch (error) {
      log(`Error editing cron schedule ${id}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically fetch all active cron schedules whose nextRunAt <= NOW().
   * Uses FOR UPDATE SKIP LOCKED to prevent duplicate enqueuing across workers.
   */
  async getDueCronSchedules(): Promise<CronScheduleRecord[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, schedule_name AS "scheduleName", cron_expression AS "cronExpression",
                job_type AS "jobType", payload, max_attempts AS "maxAttempts",
                priority, timeout_ms AS "timeoutMs",
                force_kill_on_timeout AS "forceKillOnTimeout", tags,
                timezone, allow_overlap AS "allowOverlap", status,
                last_enqueued_at AS "lastEnqueuedAt", last_job_id AS "lastJobId",
                next_run_at AS "nextRunAt",
                created_at AS "createdAt", updated_at AS "updatedAt",
                retry_delay AS "retryDelay", retry_backoff AS "retryBackoff",
                retry_delay_max AS "retryDelayMax"
         FROM cron_schedules
         WHERE status = 'active'
           AND next_run_at IS NOT NULL
           AND next_run_at <= NOW()
         ORDER BY next_run_at ASC
         FOR UPDATE SKIP LOCKED`,
      );
      log(`Found ${result.rows.length} due cron schedules`);
      return result.rows as CronScheduleRecord[];
    } catch (error: any) {
      // 42P01 = undefined_table — cron migration hasn't been run yet
      if (error?.code === '42P01') {
        log('cron_schedules table does not exist, skipping cron enqueue');
        return [];
      }
      log(`Error getting due cron schedules: ${error}`);
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE cron_schedules
         SET last_enqueued_at = $2,
             last_job_id = $3,
             next_run_at = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [id, lastEnqueuedAt, lastJobId, nextRunAt],
      );
      log(
        `Updated cron schedule ${id}: lastJobId=${lastJobId}, nextRunAt=${nextRunAt?.toISOString() ?? 'null'}`,
      );
    } catch (error) {
      log(`Error updating cron schedule ${id} after enqueue: ${error}`);
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'waiting',
            wait_until = $2,
            wait_token_id = $3,
            step_data = $4,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
        WHERE id = $1 AND status = 'processing'
      `,
        [
          jobId,
          options.waitUntil ?? null,
          options.waitTokenId ?? null,
          JSON.stringify(options.stepData),
        ],
      );
      if (result.rowCount === 0) {
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
    } catch (error) {
      log(`Error setting job ${jobId} to waiting: ${error}`);
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE job_queue SET step_data = $2, updated_at = NOW() WHERE id = $1`,
        [jobId, JSON.stringify(stepData)],
      );
    } catch (error) {
      log(`Error updating step_data for job ${jobId}: ${error}`);
    } finally {
      client.release();
    }
  }

  /**
   * Create a waitpoint token in the database.
   *
   * @param jobId - The job ID to associate with the token (null if created outside a handler).
   * @param options - Optional timeout string (e.g. '10m', '1h') and tags.
   * @returns The created waitpoint with its unique ID.
   */
  async createWaitpoint(
    jobId: number | null,
    options?: CreateTokenOptions,
  ): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      const id = `wp_${randomUUID()}`;
      let timeoutAt: Date | null = null;

      if (options?.timeout) {
        const ms = parseTimeoutString(options.timeout);
        timeoutAt = new Date(Date.now() + ms);
      }

      await client.query(
        `INSERT INTO waitpoints (id, job_id, status, timeout_at, tags) VALUES ($1, $2, 'waiting', $3, $4)`,
        [id, jobId, timeoutAt, options?.tags ?? null],
      );

      log(`Created waitpoint ${id} for job ${jobId}`);
      return { id };
    } catch (error) {
      log(`Error creating waitpoint: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete a waitpoint token and move the associated job back to 'pending'.
   *
   * @param tokenId - The waitpoint token ID to complete.
   * @param data - Optional data to pass to the waiting handler.
   */
  async completeWaitpoint(tokenId: string, data?: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const wpResult = await client.query(
        `UPDATE waitpoints SET status = 'completed', output = $2, completed_at = NOW()
         WHERE id = $1 AND status = 'waiting'
         RETURNING job_id`,
        [tokenId, data != null ? JSON.stringify(data) : null],
      );

      if (wpResult.rows.length === 0) {
        await client.query('ROLLBACK');
        log(`Waitpoint ${tokenId} not found or already completed`);
        return;
      }

      const jobId = wpResult.rows[0].job_id;

      if (jobId != null) {
        await client.query(
          `UPDATE job_queue
           SET status = 'pending', wait_token_id = NULL, wait_until = NULL, updated_at = NOW()
           WHERE id = $1 AND status = 'waiting'`,
          [jobId],
        );
      }

      await client.query('COMMIT');
      log(`Completed waitpoint ${tokenId} for job ${jobId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      log(`Error completing waitpoint ${tokenId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve a waitpoint token by its ID.
   *
   * @param tokenId - The waitpoint token ID to look up.
   * @returns The waitpoint record, or null if not found.
   */
  async getWaitpoint(tokenId: string): Promise<WaitpointRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, job_id AS "jobId", status, output, timeout_at AS "timeoutAt", created_at AS "createdAt", completed_at AS "completedAt", tags FROM waitpoints WHERE id = $1`,
        [tokenId],
      );
      if (result.rows.length === 0) return null;
      return result.rows[0] as WaitpointRecord;
    } catch (error) {
      log(`Error getting waitpoint ${tokenId}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Expire timed-out waitpoint tokens and move their associated jobs back to 'pending'.
   *
   * @returns The number of tokens that were expired.
   */
  async expireTimedOutWaitpoints(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE waitpoints
         SET status = 'timed_out'
         WHERE status = 'waiting' AND timeout_at IS NOT NULL AND timeout_at <= NOW()
         RETURNING id, job_id`,
      );

      for (const row of result.rows) {
        if (row.job_id != null) {
          await client.query(
            `UPDATE job_queue
             SET status = 'pending', wait_token_id = NULL, wait_until = NULL, updated_at = NOW()
             WHERE id = $1 AND status = 'waiting'`,
            [row.job_id],
          );
        }
      }

      await client.query('COMMIT');
      const count = result.rowCount || 0;
      if (count > 0) {
        log(`Expired ${count} timed-out waitpoints`);
      }
      return count;
    } catch (error) {
      await client.query('ROLLBACK');
      log(`Error expiring timed-out waitpoints: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  async setPendingReasonForUnpickedJobs(
    reason: string,
    jobType?: string | string[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      let jobTypeFilter = '';
      const params: any[] = [reason];
      if (jobType) {
        if (Array.isArray(jobType)) {
          jobTypeFilter = ` AND job_type = ANY($2)`;
          params.push(jobType);
        } else {
          jobTypeFilter = ` AND job_type = $2`;
          params.push(jobType);
        }
      }
      await client.query(
        `UPDATE job_queue SET pending_reason = $1 WHERE status = 'pending'${jobTypeFilter}`,
        params,
      );
    } finally {
      client.release();
    }
  }
}
