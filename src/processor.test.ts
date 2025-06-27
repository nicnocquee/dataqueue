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
    expect(failed?.payload.last_error).toBe('fail!');
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
    expect(failed?.payload.last_error).toContain('No handler registered');
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
});
