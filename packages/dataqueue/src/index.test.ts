import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initJobQueue, JobQueueConfig } from './index.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { Pool } from 'pg';

// Integration tests for index.ts

interface TestPayloadMap {
  email: { to: string };
  sms: { to: string };
  test: { foo: string };
}

describe('index integration', () => {
  let pool: Pool;
  let dbName: string;
  let testDbUrl: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    testDbUrl = setup.testDbUrl;
    const config: JobQueueConfig = {
      databaseConfig: {
        connectionString: testDbUrl,
      },
    };
    jobQueue = initJobQueue<TestPayloadMap>(config);
  });

  afterEach(async () => {
    jobQueue.getPool().end();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('should add a job and retrieve it', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });
    expect(typeof jobId).toBe('number');
    const job = await jobQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.jobType).toBe('email');
    expect(job?.payload).toEqual({ to: 'test@example.com' });
  });

  it('should get jobs by status', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'b@example.com' },
    });
    const jobs = await jobQueue.getJobsByStatus('pending');
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
  });

  it('should process a job with a registered handler', async () => {
    const handler = vi.fn(async (_payload, _signal) => {});
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'bar' },
    });
    const processor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
        sms: vi.fn(async () => {}),
        test: handler,
      },
      { pollInterval: 100 },
    );
    processor.start();
    await new Promise((r) => setTimeout(r, 300));
    processor.stop();
    const job = await jobQueue.getJob(jobId);
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, expect.any(Object));
    expect(job?.status).toBe('completed');
  });

  it('should retry a failed job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
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
      jobType: 'email',
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

  it('should cancel a scheduled job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'cancelme@example.com' },
    });
    // Cancel the job
    await jobQueue.cancelJob(jobId);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('cancelled');

    // Try to cancel a completed job (should not change status)
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'done@example.com' },
    });
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [jobId2],
    );
    await jobQueue.cancelJob(jobId2);
    const completedJob = await jobQueue.getJob(jobId2);
    expect(completedJob?.status).toBe('completed');
  });

  it('should cancel all upcoming jobs via JobQueue API', async () => {
    // Add three pending jobs
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'cancelall1@example.com' },
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'cancelall2@example.com' },
    });
    const jobId3 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'cancelall3@example.com' },
    });
    // Add a completed job
    const jobId4 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'done@example.com' },
    });
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [jobId4],
    );

    // Cancel all upcoming jobs
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs();
    expect(cancelledCount).toBeGreaterThanOrEqual(3);

    // Check that all pending jobs are now cancelled
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    const job3 = await jobQueue.getJob(jobId3);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('cancelled');
    expect(job3?.status).toBe('cancelled');

    // Completed job should remain completed
    const completedJob = await jobQueue.getJob(jobId4);
    expect(completedJob?.status).toBe('completed');
  });

  it('should cancel all upcoming jobs by jobType', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'b@example.com' },
    });
    // Cancel only email jobs
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs({
      jobType: 'email',
    });
    expect(cancelledCount).toBeGreaterThanOrEqual(1);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('pending');
  });

  it('should cancel all upcoming jobs by priority', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
      priority: 1,
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
      priority: 2,
    });
    // Cancel only priority 2 jobs
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs({
      priority: 2,
    });
    expect(cancelledCount).toBeGreaterThanOrEqual(1);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    expect(job1?.status).toBe('pending');
    expect(job2?.status).toBe('cancelled');
  });

  it('should edit all pending jobs via JobQueue API', async () => {
    // Add three pending jobs
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'batch1@example.com' },
      priority: 0,
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'batch2@example.com' },
      priority: 0,
    });
    const jobId3 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'batch3@example.com' },
      priority: 0,
    });
    // Add a completed job
    const jobId4 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'done@example.com' },
      priority: 0,
    });
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [jobId4],
    );

    // Edit all pending jobs
    const editedCount = await jobQueue.editAllPendingJobs(undefined, {
      priority: 10,
    });
    expect(editedCount).toBeGreaterThanOrEqual(3);

    // Check that all pending jobs are updated
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    const job3 = await jobQueue.getJob(jobId3);
    expect(job1?.priority).toBe(10);
    expect(job2?.priority).toBe(10);
    expect(job3?.priority).toBe(10);

    // Completed job should remain unchanged
    const completedJob = await jobQueue.getJob(jobId4);
    expect(completedJob?.priority).toBe(0);
  });

  it('should edit pending jobs with filters via JobQueue API', async () => {
    const emailJobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'email1@example.com' },
      priority: 0,
    });
    const emailJobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'email2@example.com' },
      priority: 0,
    });
    const smsJobId = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'sms@example.com' },
      priority: 0,
    });

    // Edit only email jobs
    const editedCount = await jobQueue.editAllPendingJobs(
      { jobType: 'email' },
      {
        priority: 5,
      },
    );
    expect(editedCount).toBeGreaterThanOrEqual(2);

    const emailJob1 = await jobQueue.getJob(emailJobId1);
    const emailJob2 = await jobQueue.getJob(emailJobId2);
    const smsJob = await jobQueue.getJob(smsJobId);
    expect(emailJob1?.priority).toBe(5);
    expect(emailJob2?.priority).toBe(5);
    expect(smsJob?.priority).toBe(0);
  });

  it('should cancel all upcoming jobs by runAt', async () => {
    const runAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour in future
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
      runAt: runAt,
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
    });
    // Cancel only jobs with runAt = runAt
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs({
      runAt: runAt,
    });
    expect(cancelledCount).toBeGreaterThanOrEqual(1);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('pending');
  });

  it('should cancel all upcoming jobs by jobType and priority', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
      priority: 1,
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
      priority: 2,
    });
    const jobId3 = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'c@example.com' },
      priority: 2,
    });
    // Cancel only email jobs with priority 2
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs({
      jobType: 'email',
      priority: 2,
    });
    expect(cancelledCount).toBeGreaterThanOrEqual(1);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    const job3 = await jobQueue.getJob(jobId3);
    expect(job1?.status).toBe('pending');
    expect(job2?.status).toBe('cancelled');
    expect(job3?.status).toBe('pending');
  });

  it('should cancel all upcoming jobs by tags and jobType', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tag10@example.com' },
      tags: ['foo', 'bar'],
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'tag11@example.com' },
      tags: ['foo', 'bar'],
    });
    // Only cancel email jobs with both tags
    const cancelled = await jobQueue.cancelAllUpcomingJobs({
      jobType: 'email',
      tags: { values: ['foo', 'bar'], mode: 'all' },
    });
    expect(cancelled).toBe(1);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('pending');
  });

  it('should edit a pending job via JobQueue API', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'original@example.com' },
      priority: 0,
      maxAttempts: 3,
    });

    await jobQueue.editJob(jobId, {
      payload: { to: 'updated@example.com' },
      priority: 10,
      maxAttempts: 5,
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.payload).toEqual({ to: 'updated@example.com' });
    expect(job?.priority).toBe(10);
    expect(job?.maxAttempts).toBe(5);
    expect(job?.status).toBe('pending');
  });

  it('should edit a job and then process it correctly', async () => {
    const handler = vi.fn(async (payload: { to: string }, _signal) => {
      expect(payload.to).toBe('updated@example.com');
    });
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { to: 'original@example.com' },
    });

    // Edit the job before processing
    await jobQueue.editJob(jobId, {
      payload: { to: 'updated@example.com' },
    });

    const processor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
        sms: vi.fn(async () => {}),
        test: handler,
      },
      { pollInterval: 100 },
    );
    processor.start();
    await new Promise((r) => setTimeout(r, 300));
    processor.stop();

    expect(handler).toHaveBeenCalledWith(
      { to: 'updated@example.com' },
      expect.any(Object),
    );
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
  });

  it('should silently fail when editing non-pending jobs', async () => {
    // Try to edit a completed job
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });
    const processor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
      },
      { pollInterval: 100 },
    );
    processor.start();
    await new Promise((r) => setTimeout(r, 300));
    processor.stop();

    const originalJob = await jobQueue.getJob(jobId1);
    expect(originalJob?.status).toBe('completed');

    await jobQueue.editJob(jobId1, {
      payload: { to: 'updated@example.com' },
    });

    const job = await jobQueue.getJob(jobId1);
    expect(job?.status).toBe('completed');
    expect(job?.payload).toEqual({ to: 'original@example.com' });

    // Try to edit a processing job
    // Use a handler that takes longer to ensure job stays in processing state
    const slowHandler = vi.fn(
      async (payload: { to: string }, _signal) => {
        await new Promise((r) => setTimeout(r, 200));
      },
    );
    const processor2 = jobQueue.createProcessor(
      {
        email: slowHandler,
      },
      { pollInterval: 100 },
    );
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'processing@example.com' },
    });
    processor2.start();
    // Wait a bit for job to be picked up
    await new Promise((r) => setTimeout(r, 150));
    // Job should be processing now
    const processingJob = await jobQueue.getJob(jobId2);
    if (processingJob?.status === 'processing') {
      await jobQueue.editJob(jobId2, {
        payload: { to: 'updated@example.com' },
      });

      const job2 = await jobQueue.getJob(jobId2);
      // If still processing, payload should be unchanged
      if (job2?.status === 'processing') {
        expect(job2?.payload).toEqual({ to: 'processing@example.com' });
      }
    }
    processor2.stop();
  });

  it('should record edited event when editing via JobQueue API', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });

    await jobQueue.editJob(jobId, {
      payload: { to: 'updated@example.com' },
      priority: 10,
    });

    const events = await jobQueue.getJobEvents(jobId);
    const editEvent = events.find((e) => e.eventType === 'edited');
    expect(editEvent).not.toBeUndefined();
    expect(editEvent?.metadata).toMatchObject({
      payload: { to: 'updated@example.com' },
      priority: 10,
    });
  });
});
