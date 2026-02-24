import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createProcessor,
  processBatchWithHandlers,
  processJobWithHandlers,
} from './processor.js';
import * as queue from './queue.js';
import { PostgresBackend } from './backends/postgres.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { FailureReason, JobHandler, JobContext } from './types.js';

// Define the payload map for test jobs
interface TestPayloadMap {
  test: { foo: string };
  fail: {};
  missing: {};
  batch: { i: number };
  proc: { x: number };
  typeA: { n: number };
  typeB: { n: number };
  typeC: { n: number };
}

/**
 * Claims a job by transitioning it to 'processing' status (simulates getNextBatch).
 * Tests that call processJobWithHandlers directly need the job in 'processing' state.
 */
async function claimJob(p: Pool, jobId: number) {
  await p.query(
    `UPDATE job_queue SET status = 'processing', locked_by = 'test-worker', locked_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

// Integration tests for processor

describe('processor integration', () => {
  let pool: Pool;
  let dbName: string;
  let backend: PostgresBackend;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    backend = new PostgresBackend(pool);
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('should process a job with a registered handler', async () => {
    const handler = vi.fn(async () => {});
    const handlers = {
      test: handler,
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'test'>(pool, {
      jobType: 'test',
      payload: { foo: 'bar' },
    });
    // Claim the job so it's in 'processing' status
    const [job] = await queue.getNextBatch(pool, 'test-worker', 1);
    expect(job).not.toBeNull();
    await processJobWithHandlers(backend, job!, handlers);
    expect(handler).toHaveBeenCalledWith(
      { foo: 'bar' },
      expect.any(AbortSignal),
      expect.objectContaining({
        prolong: expect.any(Function),
        onTimeout: expect.any(Function),
      }),
    );
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should mark job as failed if handler throws', async () => {
    const handler = vi.fn(async () => {
      throw new Error('fail!');
    });
    const handlers = {
      test: vi.fn(async () => {}),
      fail: handler,
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'fail'>(pool, {
      jobType: 'fail',
      payload: {},
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<TestPayloadMap, 'fail'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(backend, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorHistory?.[0]?.message).toBe('fail!');
    expect(failed?.failureReason).toBe('handler_error');
  });

  it('should mark job as failed if no handler registered', async () => {
    const handler = vi.fn(async () => {
      throw new Error('No handler registered');
    });
    const handlers = {
      test: vi.fn(async () => {}),
      fail: handler,
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'missing'>(pool, {
      jobType: 'missing',
      payload: {},
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<TestPayloadMap, 'missing'>(pool, jobId);
    expect(job).not.toBeNull();
    // @ts-expect-error - test handler is missing
    await processJobWithHandlers(backend, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorHistory?.[0]?.message).toContain(
      'No handler registered',
    );
    expect(failed?.failureReason).toBe('no_handler');
  });

  it('should process a batch of jobs', async () => {
    const handler = vi.fn(async () => {});
    const handlers = {
      test: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: handler,
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const ids = await Promise.all([
      queue.addJob<TestPayloadMap, 'batch'>(pool, {
        jobType: 'batch',
        payload: { i: 1 },
      }),
      queue.addJob<TestPayloadMap, 'batch'>(pool, {
        jobType: 'batch',
        payload: { i: 2 },
      }),
    ]);
    const processed = await processBatchWithHandlers(
      backend,
      'worker-batch',
      2,
      undefined,
      handlers,
    );
    expect(processed).toBe(2);
    const jobs = await queue.getJobsByStatus<TestPayloadMap, 'batch'>(
      pool,
      'completed',
    );
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should start and stop the processor', async () => {
    const handler = vi.fn(async () => {});
    const handlers = {
      test: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: handler,
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    await queue.addJob<TestPayloadMap, 'proc'>(pool, {
      jobType: 'proc',
      payload: { x: 1 },
    });
    const processor = createProcessor(backend, handlers, { pollInterval: 200 });
    processor.start();
    // Wait for job to be processed
    await new Promise((r) => setTimeout(r, 500));
    processor.stop();
    expect(processor.isRunning()).toBe(false);
    const jobs = await queue.getJobsByStatus(pool, 'completed');
    expect(jobs.some((j) => j.jobType === 'proc')).toBe(true);
  });

  it('should process only jobs of a specific job type with processBatch', async () => {
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    const handlers = {
      test: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: handlerA,
      typeB: handlerB,
      typeC: vi.fn(async () => {}),
    };
    const idA1 = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      jobType: 'typeA',
      payload: { n: 1 },
    });
    const idA2 = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      jobType: 'typeA',
      payload: { n: 2 },
    });
    const idB1 = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      jobType: 'typeB',
      payload: { n: 3 },
    });
    // Only process typeA
    const processed = await processBatchWithHandlers(
      backend,
      'worker-typeA',
      10,
      'typeA',
      handlers,
    );
    expect(processed).toBe(2);
    expect(handlerA).toHaveBeenCalledTimes(2);
    expect(handlerB).not.toHaveBeenCalled();
    const jobsA = await queue.getJobsByStatus<TestPayloadMap, 'typeA'>(
      pool,
      'completed',
    );
    expect(jobsA.some((j) => j.id === idA1)).toBe(true);
    expect(jobsA.some((j) => j.id === idA2)).toBe(true);
    const jobB = await queue.getJob<TestPayloadMap, 'typeB'>(pool, idB1);
    expect(jobB?.status).not.toBe('completed');
  });

  it('should process only jobs of specific job types (array) with processBatch', async () => {
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    const handlerC = vi.fn(async () => {});
    const handlers = {
      test: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: handlerA,
      typeB: handlerB,
      typeC: handlerC,
    };
    const idA = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      jobType: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      jobType: 'typeB',
      payload: { n: 2 },
    });
    const idC = await queue.addJob<TestPayloadMap, 'typeC'>(pool, {
      jobType: 'typeC',
      payload: { n: 3 },
    });
    // Only process typeA and typeC
    const processed = await processBatchWithHandlers(
      backend,
      'worker-multi',
      10,
      ['typeA', 'typeC'],
      handlers,
    );
    expect(processed).toBe(2);
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
    expect(handlerC).toHaveBeenCalledTimes(1);
    const jobs = await queue.getJobsByStatus<TestPayloadMap, 'typeA' | 'typeC'>(
      pool,
      'completed',
    );
    expect(jobs.some((j) => j.id === idA)).toBe(true);
    expect(jobs.some((j) => j.id === idC)).toBe(true);
    const jobB = await queue.getJob<TestPayloadMap, 'typeB'>(pool, idB);
    expect(jobB?.status).not.toBe('completed');
  });

  it('should process only jobs of a specific job type with createProcessor', async () => {
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    const handlers = {
      test: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: handlerA,
      typeB: handlerB,
      typeC: vi.fn(async () => {}),
    };
    const idA = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      jobType: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      jobType: 'typeB',
      payload: { n: 2 },
    });
    const processor = createProcessor(backend, handlers, {
      pollInterval: 100,
      jobType: 'typeA',
    });
    processor.start();
    await new Promise((r) => setTimeout(r, 300));
    processor.stop();
    expect(processor.isRunning()).toBe(false);
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
    const jobA = await queue.getJob<TestPayloadMap, 'typeA'>(pool, idA);
    const jobB = await queue.getJob<TestPayloadMap, 'typeB'>(pool, idB);
    expect(jobA?.status).toBe('completed');
    expect(jobB?.status).not.toBe('completed');
  });
});

describe('concurrency option', () => {
  let pool: Pool;
  let dbName: string;
  let backend: PostgresBackend;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    backend = new PostgresBackend(pool);
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestDb(dbName);
  });

  async function addJobs(n: number) {
    for (let i = 0; i < n; i++) {
      await queue.addJob<{ test: {} }, 'test'>(pool, {
        jobType: 'test',
        payload: {},
      });
    }
  }

  it('should not process more than default concurrency (3) jobs in parallel', async () => {
    let running = 0;
    let maxParallel = 0;
    const handler = async () => {
      running++;
      maxParallel = Math.max(maxParallel, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    };
    const handlers = { test: handler };
    await addJobs(10);
    const processor = createProcessor(backend, handlers, { batchSize: 10 });
    await processor.start();
    expect(maxParallel).toBeLessThanOrEqual(3);
  });

  it('should not process more than custom concurrency jobs in parallel', async () => {
    let running = 0;
    let maxParallel = 0;
    const handler = async () => {
      running++;
      maxParallel = Math.max(maxParallel, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    };
    const handlers = { test: handler };
    await addJobs(10);
    const processor = createProcessor(backend, handlers, {
      batchSize: 10,
      concurrency: 2,
    });
    await processor.start();
    expect(maxParallel).toBeLessThanOrEqual(2);
  });

  it('should not process more than batchSize jobs in parallel if concurrency > batchSize', async () => {
    let running = 0;
    let maxParallel = 0;
    const handler = async () => {
      running++;
      maxParallel = Math.max(maxParallel, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    };
    const handlers = { test: handler };
    await addJobs(2);
    const processor = createProcessor(backend, handlers, {
      batchSize: 2,
      concurrency: 5,
    });
    await processor.start();
    expect(maxParallel).toBeLessThanOrEqual(2);
  });

  it('should process jobs sequentially if concurrency is 1', async () => {
    let running = 0;
    let maxParallel = 0;
    const handler = async () => {
      running++;
      maxParallel = Math.max(maxParallel, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    };
    const handlers = { test: handler };
    await addJobs(5);
    const processor = createProcessor(backend, handlers, {
      batchSize: 5,
      concurrency: 1,
    });
    await processor.start();
    expect(maxParallel).toBe(1);
  });

  it('should throw when groupConcurrency is not a positive integer', async () => {
    const handlers = { test: vi.fn(async () => {}) };
    expect(() =>
      createProcessor(backend, handlers, {
        groupConcurrency: 0,
      }),
    ).toThrow(
      'Processor option "groupConcurrency" must be a positive integer when provided.',
    );
    expect(() =>
      createProcessor(backend, handlers, {
        groupConcurrency: 1.5,
      }),
    ).toThrow(
      'Processor option "groupConcurrency" must be a positive integer when provided.',
    );
  });
});

describe('per-job timeout', () => {
  let pool: Pool;
  let dbName: string;
  let backend: PostgresBackend;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    backend = new PostgresBackend(pool);
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('should fail the job if handler exceeds timeoutMs', async () => {
    const handler = vi.fn(async (_payload, signal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    });
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50, // 50ms
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(backend, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorHistory?.[0]?.message).toContain('timed out');
    expect(failed?.failureReason).toBe(FailureReason.Timeout);
  });

  it('should complete the job if handler finishes before timeoutMs', async () => {
    const handler = vi.fn(async (_payload, _signal) => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 200, // 200ms
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(backend, job!, handlers);
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should forcefully terminate job when forceKillOnTimeout is true', async () => {
    // Create a handler that ignores the abort signal (simulating a handler that doesn't check signal.aborted)
    // Note: We use a real function (not vi.fn) because vi.fn doesn't serialize properly for worker threads
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
    ) => {
      // This handler will run indefinitely, ignoring the abort signal
      await new Promise((resolve) => {
        setTimeout(resolve, 1000); // Will never complete in time
      });
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50, // 50ms timeout
      forceKillOnTimeout: true, // Force kill on timeout
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.forceKillOnTimeout).toBe(true);
    await processJobWithHandlers(backend, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorHistory?.[0]?.message).toContain('timed out');
    expect(failed?.failureReason).toBe(FailureReason.Timeout);
  });

  it('should complete job with forceKillOnTimeout if handler finishes before timeout', async () => {
    // Note: We use a real function (not vi.fn) because vi.fn doesn't serialize properly for worker threads
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
    ) => {
      await new Promise((r) => setTimeout(r, 20));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 200, // 200ms
      forceKillOnTimeout: true,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(backend, job!, handlers);
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });
});

describe('prolong', () => {
  let pool: Pool;
  let dbName: string;
  let backend: PostgresBackend;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    backend = new PostgresBackend(pool);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('should extend timeout when prolong is called with explicit duration', async () => {
    // Setup
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      // Wait 60ms, but initial timeout is 50ms -- would fail without prolong
      await new Promise((r) => setTimeout(r, 30));
      ctx.prolong(100); // extend to 100ms from now
      await new Promise((r) => setTimeout(r, 60));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should extend timeout when prolong is called without arguments (heartbeat)', async () => {
    // Setup
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      // Initial timeout is 80ms, total work ~120ms
      await new Promise((r) => setTimeout(r, 50));
      ctx.prolong(); // reset to original 80ms from now
      await new Promise((r) => setTimeout(r, 60));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 80,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should still timeout if prolong is not called', async () => {
    // Setup
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      signal,
    ) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe(FailureReason.Timeout);
  });

  it('should be a no-op when job has no timeout', async () => {
    // Setup
    let ctxReceived: JobContext | undefined;
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      ctxReceived = ctx;
      ctx.prolong(1000); // should be a no-op
      await new Promise((r) => setTimeout(r, 20));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      // no timeoutMs
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(ctxReceived).toBeDefined();
    expect(ctxReceived!.prolong).toBeTypeOf('function');
  });

  it('should update locked_at in the database when prolong is called', async () => {
    // Setup
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await new Promise((r) => setTimeout(r, 30));
      ctx.prolong(200);
      // Give DB time to update (fire-and-forget)
      await new Promise((r) => setTimeout(r, 50));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 100,
    });
    const jobBefore = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    // Pick up the job so it gets locked_at set
    const batch = await queue.getNextBatch<{ test: {} }, 'test'>(
      pool,
      'test-worker',
      1,
    );
    const lockedAtBefore = batch[0]!.lockedAt;

    // Act
    await processJobWithHandlers(backend, batch[0]!, handlers);

    // Assert - check that a prolonged event was recorded
    const events = await queue.getJobEvents(pool, jobId);
    const prolongedEvents = events.filter((e) => e.eventType === 'prolonged');
    expect(prolongedEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('onTimeout', () => {
  let pool: Pool;
  let dbName: string;
  let backend: PostgresBackend;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    backend = new PostgresBackend(pool);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('should extend timeout reactively when onTimeout callback returns a positive number', async () => {
    // Setup
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      ctx.onTimeout(() => {
        return 100; // extend by 100ms
      });
      // Total work: ~80ms, initial timeout 50ms -- would fail without onTimeout extension
      await new Promise((r) => setTimeout(r, 80));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should let timeout proceed when onTimeout callback returns nothing', async () => {
    // Setup
    const onTimeoutCalled = vi.fn();
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      signal,
      ctx,
    ) => {
      ctx.onTimeout(() => {
        onTimeoutCalled();
        // Return nothing -- let timeout proceed
      });
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe(FailureReason.Timeout);
    expect(onTimeoutCalled).toHaveBeenCalledTimes(1);
  });

  it('should allow repeated extensions via onTimeout', async () => {
    // Setup
    let callCount = 0;
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      ctx.onTimeout(() => {
        callCount++;
        if (callCount <= 3) {
          return 40; // extend by 40ms each time
        }
        // After 3 extensions, let it complete (job should be done by then)
      });
      // Total work: ~130ms, initial timeout 40ms
      // Will need ~3 extensions of 40ms each
      await new Promise((r) => setTimeout(r, 130));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 40,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('should allow onTimeout with progress-based logic', async () => {
    // Setup
    let progress = 0;
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      ctx.onTimeout(() => {
        if (progress < 100) {
          return 60; // still working, extend
        }
        // done, let timeout proceed if it fires again
      });
      // Simulate progress
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 25));
        progress += 20;
      }
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(progress).toBe(100);
  });

  it('should work when both prolong and onTimeout are used together', async () => {
    // Setup
    let onTimeoutCalled = false;
    const handler: JobHandler<{ test: {} }, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      // Register reactive fallback
      ctx.onTimeout(() => {
        onTimeoutCalled = true;
        return 100;
      });
      // Proactively extend before timeout hits
      await new Promise((r) => setTimeout(r, 30));
      ctx.prolong(100);
      await new Promise((r) => setTimeout(r, 60));
    };
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      jobType: 'test',
      payload: {},
      timeoutMs: 50,
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    // onTimeout should NOT have been called since prolong extended before timeout fired
    expect(onTimeoutCalled).toBe(false);
  });

  it('should persist progress via ctx.setProgress', async () => {
    // Setup
    const handler: JobHandler<TestPayloadMap, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.setProgress(25);
      await ctx.setProgress(50);
      await ctx.setProgress(100);
    };
    const handlers = {
      test: handler,
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'test'>(pool, {
      jobType: 'test',
      payload: { foo: 'bar' },
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<TestPayloadMap, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(completed?.progress).toBe(100);
  });

  it('should reject progress values outside 0-100', async () => {
    expect.assertions(2);

    // Setup
    const handler: JobHandler<TestPayloadMap, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      try {
        await ctx.setProgress(-1);
      } catch (err) {
        expect((err as Error).message).toBe(
          'Progress must be between 0 and 100',
        );
      }
      try {
        await ctx.setProgress(101);
      } catch (err) {
        expect((err as Error).message).toBe(
          'Progress must be between 0 and 100',
        );
      }
    };
    const handlers = {
      test: handler,
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'test'>(pool, {
      jobType: 'test',
      payload: { foo: 'bar' },
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<TestPayloadMap, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);
  });

  it('should round fractional progress values', async () => {
    // Setup
    const handler: JobHandler<TestPayloadMap, 'test'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.setProgress(33.7);
    };
    const handlers = {
      test: handler,
      fail: vi.fn(async () => {}),
      missing: vi.fn(async () => {}),
      batch: vi.fn(async () => {}),
      proc: vi.fn(async () => {}),
      typeA: vi.fn(async () => {}),
      typeB: vi.fn(async () => {}),
      typeC: vi.fn(async () => {}),
    };
    const jobId = await queue.addJob<TestPayloadMap, 'test'>(pool, {
      jobType: 'test',
      payload: { foo: 'bar' },
    });
    await claimJob(pool, jobId);
    const job = await queue.getJob<TestPayloadMap, 'test'>(pool, jobId);

    // Act
    await processJobWithHandlers(backend, job!, handlers);

    // Assert
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.progress).toBe(34);
  });
});
