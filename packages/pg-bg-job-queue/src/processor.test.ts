import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  registerJobHandlers,
  processJob,
  processBatch,
  createProcessor,
} from './processor.js';
import * as queue from './queue.js';
import { createTestSchemaAndPool, destroyTestSchema } from './test-util.js';

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
  let schema: string;
  let basePool: Pool;

  beforeEach(async () => {
    const setup = await createTestSchemaAndPool();
    pool = setup.pool;
    schema = setup.schema;
    basePool = setup.basePool;
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestSchema(basePool, schema);
  });

  it('should process a job with a registered handler', async () => {
    const handler = vi.fn(async () => {});
    registerJobHandlers<TestPayloadMap>(
      {
        test: handler,
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: vi.fn(async () => {}),
        typeB: vi.fn(async () => {}),
        typeC: vi.fn(async () => {}),
      },
      true,
    );
    const jobId = await queue.addJob<TestPayloadMap, 'test'>(pool, {
      job_type: 'test',
      payload: { foo: 'bar' },
    });
    const job = await queue.getJob<TestPayloadMap, 'test'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should mark job as failed if handler throws', async () => {
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: async () => {
          throw new Error('fail!');
        },
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: vi.fn(async () => {}),
        typeB: vi.fn(async () => {}),
        typeC: vi.fn(async () => {}),
      },
      true,
    );
    const jobId = await queue.addJob<TestPayloadMap, 'fail'>(pool, {
      job_type: 'fail',
      payload: {},
    });
    const job = await queue.getJob<TestPayloadMap, 'fail'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_history?.[0]?.message).toBe('fail!');
  });

  it('should mark job as failed if no handler registered', async () => {
    registerJobHandlers<TestPayloadMap>(
      // @ts-expect-error missing handler
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: vi.fn(async () => {}),
        typeB: vi.fn(async () => {}),
        typeC: vi.fn(async () => {}),
      },
      true,
    );
    const jobId = await queue.addJob<TestPayloadMap, 'missing'>(pool, {
      job_type: 'missing',
      payload: {},
    });
    const job = await queue.getJob<TestPayloadMap, 'missing'>(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error_history?.[0]?.message).toContain(
      'No handler registered',
    );
  });

  it('should process a batch of jobs', async () => {
    const handler = vi.fn(async () => {});
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: handler,
        proc: vi.fn(async () => {}),
        typeA: vi.fn(async () => {}),
        typeB: vi.fn(async () => {}),
        typeC: vi.fn(async () => {}),
      },
      true,
    );
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
    const processed = await processBatch(pool, 'worker-batch', 2);
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
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: handler,
        typeA: vi.fn(async () => {}),
        typeB: vi.fn(async () => {}),
        typeC: vi.fn(async () => {}),
      },
      true,
    );
    await queue.addJob<TestPayloadMap, 'proc'>(pool, {
      job_type: 'proc',
      payload: { x: 1 },
    });
    const processor = createProcessor(pool, { pollInterval: 200 });
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
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: handlerA,
        typeB: handlerB,
        typeC: vi.fn(async () => {}),
      },
      true,
    );
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
    const processed = await processBatch(pool, 'worker-typeA', 10, 'typeA');
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
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: handlerA,
        typeB: handlerB,
        typeC: handlerC,
      },
      true,
    );
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
    const processed = await processBatch(pool, 'worker-multi', 10, [
      'typeA',
      'typeC',
    ]);
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
    registerJobHandlers<TestPayloadMap>(
      {
        test: vi.fn(async () => {}),
        fail: vi.fn(async () => {}),
        missing: vi.fn(async () => {}),
        batch: vi.fn(async () => {}),
        proc: vi.fn(async () => {}),
        typeA: handlerA,
        typeB: handlerB,
        typeC: vi.fn(async () => {}),
      },
      true,
    );
    const idA = await queue.addJob<TestPayloadMap, 'typeA'>(pool, {
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob<TestPayloadMap, 'typeB'>(pool, {
      job_type: 'typeB',
      payload: { n: 2 },
    });
    const processor = createProcessor(pool, {
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
