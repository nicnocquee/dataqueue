import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  registerJobHandler,
  processJob,
  processBatch,
  createProcessor,
} from './processor.js';
import * as queue from './queue.js';
import { createTestSchemaAndPool, destroyTestSchema } from './test-util.js';

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
    registerJobHandler('test', handler);
    const jobId = await queue.addJob(pool, {
      job_type: 'test',
      payload: { foo: 'bar' },
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });

  it('should mark job as failed if handler throws', async () => {
    registerJobHandler('fail', async () => {
      throw new Error('fail!');
    });
    const jobId = await queue.addJob(pool, {
      job_type: 'fail',
      payload: {},
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect((failed?.payload as { last_error: string }).last_error).toBe(
      'fail!',
    );
  });

  it('should mark job as failed if no handler registered', async () => {
    const jobId = await queue.addJob(pool, {
      job_type: 'missing',
      payload: {},
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    await processJob(pool, job!);
    const failed = await queue.getJob(pool, jobId);
    expect(failed?.status).toBe('failed');
    expect((failed?.payload as { last_error: string }).last_error).toContain(
      'No handler registered',
    );
  });

  it('should process a batch of jobs', async () => {
    const handler = vi.fn(async () => {});
    registerJobHandler('batch', handler);
    const ids = await Promise.all([
      queue.addJob(pool, { job_type: 'batch', payload: { i: 1 } }),
      queue.addJob(pool, { job_type: 'batch', payload: { i: 2 } }),
    ]);
    const processed = await processBatch(pool, 'worker-batch', 2);
    expect(processed).toBe(2);
    const jobs = await queue.getJobsByStatus(pool, 'completed');
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should start and stop the processor', async () => {
    const handler = vi.fn(async () => {});
    registerJobHandler('proc', handler);
    await queue.addJob(pool, { job_type: 'proc', payload: { x: 1 } });
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
    registerJobHandler('typeA', handlerA);
    registerJobHandler('typeB', handlerB);
    const idA1 = await queue.addJob(pool, {
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idA2 = await queue.addJob(pool, {
      job_type: 'typeA',
      payload: { n: 2 },
    });
    const idB1 = await queue.addJob(pool, {
      job_type: 'typeB',
      payload: { n: 3 },
    });
    // Only process typeA
    const processed = await processBatch(pool, 'worker-typeA', 10, 'typeA');
    expect(processed).toBe(2);
    expect(handlerA).toHaveBeenCalledTimes(2);
    expect(handlerB).not.toHaveBeenCalled();
    const jobsA = await queue.getJobsByStatus(pool, 'completed');
    expect(jobsA.some((j) => j.id === idA1)).toBe(true);
    expect(jobsA.some((j) => j.id === idA2)).toBe(true);
    const jobB = await queue.getJob(pool, idB1);
    expect(jobB?.status).not.toBe('completed');
  });

  it('should process only jobs of specific job types (array) with processBatch', async () => {
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    const handlerC = vi.fn(async () => {});
    registerJobHandler('typeA', handlerA);
    registerJobHandler('typeB', handlerB);
    registerJobHandler('typeC', handlerC);
    const idA = await queue.addJob(pool, {
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob(pool, {
      job_type: 'typeB',
      payload: { n: 2 },
    });
    const idC = await queue.addJob(pool, {
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
    const jobs = await queue.getJobsByStatus(pool, 'completed');
    expect(jobs.some((j) => j.id === idA)).toBe(true);
    expect(jobs.some((j) => j.id === idC)).toBe(true);
    const jobB = await queue.getJob(pool, idB);
    expect(jobB?.status).not.toBe('completed');
  });

  it('should process only jobs of a specific job type with createProcessor', async () => {
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    registerJobHandler('typeA', handlerA);
    registerJobHandler('typeB', handlerB);
    const idA = await queue.addJob(pool, {
      job_type: 'typeA',
      payload: { n: 1 },
    });
    const idB = await queue.addJob(pool, {
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
    const jobA = await queue.getJob(pool, idA);
    const jobB = await queue.getJob(pool, idB);
    expect(jobA?.status).toBe('completed');
    expect(jobB?.status).not.toBe('completed');
  });
});
