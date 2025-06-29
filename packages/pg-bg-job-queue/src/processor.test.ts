import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createProcessor,
  processBatchWithHandlers,
  processJobWithHandlers,
} from './processor.js';
import * as queue from './queue.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { FailureReason, JobHandler } from './types.js';

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

// Integration tests for processor

describe('processor integration', () => {
  let pool: Pool;
  let dbName: string;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
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
      job_type: 'test',
      payload: { foo: 'bar' },
    });
    const job = await queue.getJob<TestPayloadMap, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(pool, job!, handlers);
    expect(handler).toHaveBeenCalledWith(
      { foo: 'bar' },
      expect.any(AbortSignal),
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
      job_type: 'fail',
      payload: {},
    });
    const job = await queue.getJob<TestPayloadMap, 'fail'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(pool, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_history?.[0]?.message).toBe('fail!');
    expect(failed?.failure_reason).toBe('handler_error');
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
      job_type: 'missing',
      payload: {},
    });
    const job = await queue.getJob<TestPayloadMap, 'missing'>(pool, jobId);
    expect(job).not.toBeNull();
    // @ts-expect-error - test handler is missing
    await processJobWithHandlers(pool, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_history?.[0]?.message).toContain(
      'No handler registered',
    );
    expect(failed?.failure_reason).toBe('no_handler');
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
        job_type: 'batch',
        payload: { i: 1 },
      }),
      queue.addJob<TestPayloadMap, 'batch'>(pool, {
        job_type: 'batch',
        payload: { i: 2 },
      }),
    ]);
    const processed = await processBatchWithHandlers(
      pool,
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
      job_type: 'proc',
      payload: { x: 1 },
    });
    const processor = createProcessor(pool, handlers, { pollInterval: 200 });
    processor.start();
    // Wait for job to be processed
    await new Promise((r) => setTimeout(r, 500));
    processor.stop();
    expect(processor.isRunning()).toBe(false);
    const jobs = await queue.getJobsByStatus(pool, 'completed');
    expect(jobs.some((j) => j.job_type === 'proc')).toBe(true);
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
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idA2 = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      job_type: 'typeA',
      payload: { n: 2 },
    });
    const idB1 = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      job_type: 'typeB',
      payload: { n: 3 },
    });
    // Only process typeA
    const processed = await processBatchWithHandlers(
      pool,
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
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      job_type: 'typeB',
      payload: { n: 2 },
    });
    const idC = await queue.addJob<TestPayloadMap, 'typeC'>(pool, {
      job_type: 'typeC',
      payload: { n: 3 },
    });
    // Only process typeA and typeC
    const processed = await processBatchWithHandlers(
      pool,
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
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      job_type: 'typeB',
      payload: { n: 2 },
    });
    const processor = createProcessor(pool, handlers, {
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

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestDb(dbName);
  });

  async function addJobs(n: number) {
    for (let i = 0; i < n; i++) {
      await queue.addJob<{ test: {} }, 'test'>(pool, {
        job_type: 'test',
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
    const processor = createProcessor(pool, handlers, { batchSize: 10 });
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
    const processor = createProcessor(pool, handlers, {
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
    const processor = createProcessor(pool, handlers, {
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
    const processor = createProcessor(pool, handlers, {
      batchSize: 5,
      concurrency: 1,
    });
    await processor.start();
    expect(maxParallel).toBe(1);
  });
});

describe('per-job timeout', () => {
  let pool: Pool;
  let dbName: string;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
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
      job_type: 'test',
      payload: {},
      timeoutMs: 50, // 50ms
    });
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(pool, job!, handlers);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_history?.[0]?.message).toContain('timed out');
    expect(failed?.failure_reason).toBe(FailureReason.Timeout);
  });

  it('should complete the job if handler finishes before timeoutMs', async () => {
    const handler = vi.fn(async (_payload, _signal) => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const handlers: { test: JobHandler<{ test: {} }, 'test'> } = {
      test: handler,
    };
    const jobId = await queue.addJob<{ test: {} }, 'test'>(pool, {
      job_type: 'test',
      payload: {},
      timeoutMs: 200, // 200ms
    });
    const job = await queue.getJob<{ test: {} }, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJobWithHandlers(pool, job!, handlers);
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });
});
