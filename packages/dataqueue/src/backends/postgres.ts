import { Pool } from 'pg';
import {
  JobOptions,
  JobRecord,
  FailureReason,
  JobEvent,
  JobEventType,
  TagQueryMode,
  JobType,
} from '../types.js';
import { QueueBackend, JobFilters, JobUpdates } from '../backend.js';
import { log } from '../log-context.js';

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
    const client = await this.pool.connect();
    try {
      let result;
      const onConflict = idempotencyKey
        ? `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
        : '';

      if (runAt) {
        result = await client.query(
          `INSERT INTO job_queue 
            (job_type, payload, max_attempts, priority, run_at, timeout_ms, force_kill_on_timeout, tags, idempotency_key) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
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
          ],
        );
      } else {
        result = await client.query(
          `INSERT INTO job_queue 
            (job_type, payload, max_attempts, priority, timeout_ms, force_kill_on_timeout, tags, idempotency_key) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
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
          ],
        );
      }

      // If ON CONFLICT DO NOTHING was triggered, no rows are returned.
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
      await this.recordJobEvent(jobId, JobEventType.Added, {
        jobType,
        payload,
        tags,
        idempotencyKey,
      });
      return jobId;
    } catch (error) {
      log(`Error adding job: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async getJob<PayloadMap, T extends JobType<PayloadMap>>(
    id: number,
  ): Promise<JobRecord<PayloadMap, T> | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue WHERE id = $1`,
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
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
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
        `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
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
      let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData" FROM job_queue`;
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
      let query = `SELECT id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_failed_at AS "lastFailedAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", tags, idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData"
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
  ): Promise<JobRecord<PayloadMap, T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let jobTypeFilter = '';
      const params: any[] = [workerId, batchSize];
      if (jobType) {
        if (Array.isArray(jobType)) {
          jobTypeFilter = ` AND job_type = ANY($3)`;
          params.push(jobType);
        } else {
          jobTypeFilter = ` AND job_type = $3`;
          params.push(jobType);
        }
      }

      const result = await client.query(
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
          SELECT id FROM job_queue
          WHERE (
            (
              (status = 'pending' OR (status = 'failed' AND next_attempt_at <= NOW()))
              AND (attempts < max_attempts)
              AND run_at <= NOW()
            )
            OR (
              status = 'waiting'
              AND wait_until IS NOT NULL
              AND wait_until <= NOW()
              AND wait_token_id IS NULL
            )
          )
          ${jobTypeFilter}
          ORDER BY priority DESC, created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, job_type AS "jobType", payload, status, max_attempts AS "maxAttempts", attempts, priority, run_at AS "runAt", timeout_ms AS "timeoutMs", force_kill_on_timeout AS "forceKillOnTimeout", created_at AS "createdAt", updated_at AS "updatedAt", started_at AS "startedAt", completed_at AS "completedAt", last_failed_at AS "lastFailedAt", locked_at AS "lockedAt", locked_by AS "lockedBy", error_history AS "errorHistory", failure_reason AS "failureReason", next_attempt_at AS "nextAttemptAt", last_retried_at AS "lastRetriedAt", last_cancelled_at AS "lastCancelledAt", pending_reason AS "pendingReason", idempotency_key AS "idempotencyKey", wait_until AS "waitUntil", wait_token_id AS "waitTokenId", step_data AS "stepData"
      `,
        params,
      );

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

  async completeJob(jobId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE job_queue
        SET status = 'completed', updated_at = NOW(), completed_at = NOW(),
            step_data = NULL, wait_until = NULL, wait_token_id = NULL
        WHERE id = $1 AND status = 'processing'
      `,
        [jobId],
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
              WHEN attempts < max_attempts THEN NOW() + (POWER(2, attempts) * INTERVAL '1 minute')
              ELSE NULL
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

  async cleanupOldJobs(daysToKeep = 30): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        DELETE FROM job_queue
        WHERE status = 'completed'
        AND updated_at < NOW() - INTERVAL '1 day' * $1::int
        RETURNING id
      `,
        [daysToKeep],
      );
      log(`Deleted ${result.rowCount} old jobs`);
      return result.rowCount || 0;
    } catch (error) {
      log(`Error cleaning up old jobs: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupOldJobEvents(daysToKeep = 30): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        DELETE FROM job_events
        WHERE created_at < NOW() - INTERVAL '1 day' * $1::int
        RETURNING id
      `,
        [daysToKeep],
      );
      log(`Deleted ${result.rowCount} old job events`);
      return result.rowCount || 0;
    } catch (error) {
      log(`Error cleaning up old job events: ${error}`);
      throw error;
    } finally {
      client.release();
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
          AND locked_at < NOW() - INTERVAL '1 minute' * $1::int
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
