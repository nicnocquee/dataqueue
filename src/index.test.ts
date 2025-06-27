import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initJobQueue, JobQueueConfig, JobOptions } from './index.js';
import { createTestSchemaAndPool, destroyTestSchema } from './test-util.js';
import { Pool } from 'pg';

// Integration tests for index.ts

describe('index integration', () => {
  let pool: Pool;
  let schema: string;
  let basePool: Pool;
  let jobQueue: Awaited<ReturnType<typeof initJobQueue>>;

  beforeEach(async () => {
    const setup = await createTestSchemaAndPool();
    pool = setup.pool;
    schema = setup.schema;
    basePool = setup.basePool;
    const config: JobQueueConfig = {
      databaseConfig: {
        connectionString:
          process.env.PG_TEST_URL ||
          'postgres://postgres:postgres@localhost:5432/postgres',
      },
    };
    jobQueue = await initJobQueue(config);
    // Set search_path for the session to the test schema
    await jobQueue.getPool().query(`SET search_path TO ${schema}`);
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestSchema(basePool, schema);
  });

  it('should add a job and retrieve it', async () => {
    const jobId = await jobQueue.addJob({
      job_type: 'email',
      payload: { to: 'test@example.com' },
    });
    expect(typeof jobId).toBe('number');
    const job = await jobQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.job_type).toBe('email');
    expect(job?.payload).toEqual({ to: 'test@example.com' });
  });

  it('should get jobs by status', async () => {
    const jobId1 = await jobQueue.addJob({
      job_type: 'email',
      payload: { to: 'a@example.com' },
    });
    const jobId2 = await jobQueue.addJob({
      job_type: 'sms',
      payload: { to: 'b@example.com' },
    });
    const jobs = await jobQueue.getJobsByStatus('pending');
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
  });

  it('should process a job with a registered handler', async () => {
    const handler = vi.fn(async () => {});
    jobQueue.registerJobHandler('test', handler);
    const jobId = await jobQueue.addJob({
      job_type: 'test',
      payload: { foo: 'bar' },
    });
    const processor = jobQueue.createProcessor({ pollInterval: 100 });
    processor.start();
    await new Promise((r) => setTimeout(r, 300));
    processor.stop();
    const job = await jobQueue.getJob(jobId);
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    expect(job?.status).toBe('completed');
  });

  it('should retry a failed job', async () => {
    const jobId = await jobQueue.addJob({
      job_type: 'email',
      payload: { to: 'fail@example.com' },
    });
    // Manually mark as failed
    await pool.query(`UPDATE job_queue SET status = 'failed' WHERE id = $1`, [
      jobId,
    ]);
    let job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('failed');
    await jobQueue.retryJob(jobId);
    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
  });

  it('should cleanup old completed jobs', async () => {
    const jobId = await jobQueue.addJob({
      job_type: 'email',
      payload: { to: 'cleanup@example.com' },
    });
    // Mark as completed
    await pool.query(
      `UPDATE job_queue SET status = 'completed', updated_at = NOW() - INTERVAL '31 days' WHERE id = $1`,
      [jobId],
    );
    const deleted = await jobQueue.cleanupOldJobs(30);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const job = await jobQueue.getJob(jobId);
    expect(job).toBeNull();
  });

  it('getPool should return the underlying pool', () => {
    expect(jobQueue.getPool()).toBeInstanceOf(Pool);
  });
});
