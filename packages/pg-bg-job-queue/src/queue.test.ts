import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as queue from './queue.js';
import { createTestSchemaAndPool, destroyTestSchema } from './test-util.js';

// Example integration test setup

describe('queue integration', () => {
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

  it('should add a job and retrieve it', async () => {
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'test@example.com' },
    });
    expect(typeof jobId).toBe('number');
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.job_type).toBe('email');
    expect(job?.payload).toEqual({ to: 'test@example.com' });
  });

  it('should get jobs by status', async () => {
    // Add two jobs
    const jobId1 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'a@example.com' },
    });
    const jobId2 = await queue.addJob(pool, {
      job_type: 'sms',
      payload: { to: 'b@example.com' },
    });
    // All jobs should be 'pending' by default
    const jobs = await queue.getJobsByStatus(pool, 'pending');
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
  });

  it('should retry a failed job', async () => {
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'fail@example.com' },
    });
    // Mark as failed
    await queue.failJob(pool, jobId, new Error('fail reason'));
    let job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('failed');
    // Retry
    await queue.retryJob(pool, jobId);
    job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('pending');
  });

  it('should mark a job as completed', async () => {
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'done@example.com' },
    });
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
  });

  it('should get the next batch of jobs to process', async () => {
    // Add jobs (do not set run_at, use DB default)
    const jobId1 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'batch1@example.com' },
    });
    const jobId2 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'batch2@example.com' },
    });
    const jobs = await queue.getNextBatch(pool, 'worker-1', 2);
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
    // They should now be 'processing'
    const job1 = await queue.getJob(pool, jobId1);
    expect(job1?.status).toBe('processing');
  });

  it('should not pick up jobs scheduled in the future', async () => {
    // Add a job scheduled 1 day in the future
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'future@example.com' },
      run_at: futureDate,
    });
    const jobs = await queue.getNextBatch(pool, 'worker-2', 1);
    const ids = jobs.map((j) => j.id);
    expect(ids).not.toContain(jobId);
    // The job should still be pending
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('pending');
  });

  it('should cleanup old completed jobs', async () => {
    // Add and complete a job
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'cleanup@example.com' },
    });
    await queue.completeJob(pool, jobId);
    // Manually update updated_at to be old
    await pool.query(
      `UPDATE job_queue SET updated_at = NOW() - INTERVAL '31 days' WHERE id = $1`,
      [jobId],
    );
    // Cleanup jobs older than 30 days
    const deleted = await queue.cleanupOldJobs(pool, 30);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(pool, jobId);
    expect(job).toBeNull();
  });

  it('should cancel a scheduled job', async () => {
    const jobId = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'cancelme@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('cancelled');

    // Try to cancel a job that is already completed
    const jobId2 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'done@example.com' },
    });
    await queue.completeJob(pool, jobId2);
    await queue.cancelJob(pool, jobId2);
    const completedJob = await queue.getJob(pool, jobId2);
    expect(completedJob?.status).toBe('completed');
  });

  it('should cancel all upcoming jobs', async () => {
    // Add three pending jobs
    const jobId1 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'cancelall1@example.com' },
    });
    const jobId2 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'cancelall2@example.com' },
    });
    const jobId3 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'cancelall3@example.com' },
    });
    // Add a completed job
    const jobId4 = await queue.addJob(pool, {
      job_type: 'email',
      payload: { to: 'done@example.com' },
    });
    await queue.completeJob(pool, jobId4);

    // Cancel all upcoming jobs
    const cancelledCount = await queue.cancelAllUpcomingJobs(pool);
    expect(cancelledCount).toBeGreaterThanOrEqual(3);

    // Check that all pending jobs are now cancelled
    const job1 = await queue.getJob(pool, jobId1);
    const job2 = await queue.getJob(pool, jobId2);
    const job3 = await queue.getJob(pool, jobId3);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('cancelled');
    expect(job3?.status).toBe('cancelled');

    // Completed job should remain completed
    const completedJob = await queue.getJob(pool, jobId4);
    expect(completedJob?.status).toBe('completed');
  });
});
