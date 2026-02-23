import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as queue from './queue.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { JobEvent, JobEventType } from './types.js';
import { objectKeysToCamelCase } from './utils.js';

describe('queue integration', () => {
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

  it('should add a job and retrieve it', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });
    expect(typeof jobId).toBe('number');
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.jobType).toBe('email');
    expect(job?.payload).toEqual({ to: 'test@example.com' });
  });

  it('should get jobs by status', async () => {
    // Add two jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ sms: { to: string } }, 'sms'>(pool, {
      jobType: 'sms',
      payload: { to: 'b@example.com' },
    });
    // All jobs should be 'pending' by default
    const jobs = await queue.getJobsByStatus(pool, 'pending');
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
  });

  it('should retry a failed job', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'done@example.com' },
    });
    // Claim the job first (sets status to 'processing')
    await queue.getNextBatch(pool, 'worker-complete', 1);
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
  });

  it('should store output when completing a job', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'output@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-output', 1);
    await queue.completeJob(pool, jobId, {
      url: 'https://example.com/report.pdf',
    });
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toEqual({ url: 'https://example.com/report.pdf' });
  });

  it('should have null output when completing without output', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'no-output@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-no-output', 1);
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toBeNull();
  });

  it('should preserve output set via updateOutput when completing without output arg', async () => {
    const { PostgresBackend } = await import('./backends/postgres.js');
    const backend = new PostgresBackend(pool);
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'pre-output@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-pre-output', 1);
    await backend.updateOutput(jobId, { interim: true });
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toEqual({ interim: true });
  });

  it('should get the next batch of jobs to process', async () => {
    // Add jobs (do not set runAt, use DB default)
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'batch1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'batch2@example.com' },
      },
    );
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'future@example.com' },
      runAt: futureDate,
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'cleanup@example.com' },
    });
    // Claim then complete the job
    await queue.getNextBatch(pool, 'worker-cleanup', 1);
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

  it('should cleanup old completed jobs in batches', async () => {
    // Add and complete 5 jobs
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(
        pool,
        {
          jobType: 'email',
          payload: { to: `batch-${i}@example.com` },
        },
      );
      await queue.getNextBatch(pool, 'worker-batch-cleanup', 1);
      await queue.completeJob(pool, jobId);
      ids.push(jobId);
    }
    // Manually backdate all 5
    await pool.query(
      `UPDATE job_queue SET updated_at = NOW() - INTERVAL '31 days' WHERE id = ANY($1::int[])`,
      [ids],
    );
    // Cleanup with batchSize=2 so it takes multiple iterations
    const deleted = await queue.cleanupOldJobs(pool, 30, 2);
    expect(deleted).toBe(5);
    for (const id of ids) {
      const job = await queue.getJob(pool, id);
      expect(job).toBeNull();
    }
  });

  it('should cancel a scheduled job', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'cancelme@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('cancelled');

    // Try to cancel a job that is already completed
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'done@example.com' },
      },
    );
    await queue.getNextBatch(pool, 'worker-cancel-done', 1);
    await queue.completeJob(pool, jobId2);
    await queue.cancelJob(pool, jobId2);
    const completedJob = await queue.getJob(pool, jobId2);
    expect(completedJob?.status).toBe('completed');
  });

  it('should edit a pending job with all fields', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
      priority: 0,
      maxAttempts: 3,
      timeoutMs: 10000,
      tags: ['original'],
    });
    const originalJob = await queue.getJob(pool, jobId);
    const originalUpdatedAt = originalJob?.updatedAt;

    // Wait a bit to ensure updated_at changes
    await new Promise((r) => setTimeout(r, 10));

    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      payload: { to: 'updated@example.com' },
      priority: 10,
      maxAttempts: 5,
      runAt: new Date(Date.now() + 60000),
      timeoutMs: 20000,
      tags: ['updated', 'priority'],
    });

    const updatedJob = await queue.getJob(pool, jobId);
    expect(updatedJob?.payload).toEqual({ to: 'updated@example.com' });
    expect(updatedJob?.priority).toBe(10);
    expect(updatedJob?.maxAttempts).toBe(5);
    expect(updatedJob?.timeoutMs).toBe(20000);
    expect(updatedJob?.tags).toEqual(['updated', 'priority']);
    expect(updatedJob?.status).toBe('pending');
    expect(updatedJob?.updatedAt.getTime()).toBeGreaterThan(
      originalUpdatedAt?.getTime() || 0,
    );
  });

  it('should edit a pending job with partial fields', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
      priority: 0,
      maxAttempts: 3,
    });

    // Only update payload
    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      payload: { to: 'updated@example.com' },
    });

    const updatedJob = await queue.getJob(pool, jobId);
    expect(updatedJob?.payload).toEqual({ to: 'updated@example.com' });
    expect(updatedJob?.priority).toBe(0); // Unchanged
    expect(updatedJob?.maxAttempts).toBe(3); // Unchanged

    // Only update priority
    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      priority: 5,
    });

    const updatedJob2 = await queue.getJob(pool, jobId);
    expect(updatedJob2?.payload).toEqual({ to: 'updated@example.com' }); // Still updated
    expect(updatedJob2?.priority).toBe(5); // Now updated
  });

  it('should silently fail when editing a non-pending job', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-edit-noop', 1);
    await queue.completeJob(pool, jobId);

    // Try to edit a completed job - should silently fail
    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      payload: { to: 'updated@example.com' },
    });

    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
    expect(job?.payload).toEqual({ to: 'original@example.com' }); // Unchanged

    // Try to edit a processing job
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'processing@example.com' },
      },
    );
    await queue.getNextBatch(pool, 'worker-edit', 1);
    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId2, {
      payload: { to: 'updated@example.com' },
    });

    const job2 = await queue.getJob(pool, jobId2);
    expect(job2?.status).toBe('processing');
    expect(job2?.payload).toEqual({ to: 'processing@example.com' }); // Unchanged
  });

  it('should record edited event when editing a job', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });

    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      payload: { to: 'updated@example.com' },
      priority: 10,
    });

    const res = await pool.query(
      'SELECT * FROM job_events WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId],
    );
    const events = res.rows.map(
      (row) => objectKeysToCamelCase(row) as JobEvent,
    );
    const editEvent = events.find((e) => e.eventType === JobEventType.Edited);
    expect(editEvent).not.toBeUndefined();
    expect(editEvent?.metadata).toMatchObject({
      payload: { to: 'updated@example.com' },
      priority: 10,
    });
  });

  it('should update updated_at timestamp when editing', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });
    const originalJob = await queue.getJob(pool, jobId);
    const originalUpdatedAt = originalJob?.updatedAt;

    // Wait a bit to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));

    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      priority: 5,
    });

    const updatedJob = await queue.getJob(pool, jobId);
    expect(updatedJob?.updatedAt.getTime()).toBeGreaterThan(
      originalUpdatedAt?.getTime() || 0,
    );
  });

  it('should handle editing with null values', async () => {
    const futureDate = new Date(Date.now() + 60000);
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
      runAt: futureDate,
      timeoutMs: 10000,
      tags: ['original'],
    });

    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {
      runAt: null,
      timeoutMs: null,
      tags: null,
    });

    const updatedJob = await queue.getJob(pool, jobId);
    expect(updatedJob?.runAt).not.toBeNull(); // runAt null means use default (now)
    expect(updatedJob?.timeoutMs).toBeNull();
    expect(updatedJob?.tags).toBeNull();
  });

  it('should do nothing when editing with no fields', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'original@example.com' },
    });
    const originalJob = await queue.getJob(pool, jobId);

    await queue.editJob<{ email: { to: string } }, 'email'>(pool, jobId, {});

    const job = await queue.getJob(pool, jobId);
    expect(job?.payload).toEqual(originalJob?.payload);
    expect(job?.priority).toBe(originalJob?.priority);
  });

  it('should edit all pending jobs without filters', async () => {
    // Add three pending jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'batch1@example.com' },
        priority: 0,
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'batch2@example.com' },
        priority: 0,
      },
    );
    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'batch3@example.com' },
        priority: 0,
      },
    );
    // Add a completed job (set via SQL since this test is about edit behavior)
    const jobId4 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'done@example.com' },
      },
    );
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [jobId4],
    );

    // Edit all pending jobs
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(pool, undefined, {
      priority: 10,
    });
    expect(editedCount).toBeGreaterThanOrEqual(3);

    // Check that all pending jobs are updated
    const job1 = await queue.getJob(pool, jobId1);
    const job2 = await queue.getJob(pool, jobId2);
    const job3 = await queue.getJob(pool, jobId3);
    expect(job1?.priority).toBe(10);
    expect(job2?.priority).toBe(10);
    expect(job3?.priority).toBe(10);

    // Completed job should remain unchanged
    const completedJob = await queue.getJob(pool, jobId4);
    expect(completedJob?.priority).toBe(0);
  });

  it('should edit pending jobs filtered by jobType', async () => {
    const emailJobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'email1@example.com' },
        priority: 0,
      },
    );
    const emailJobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'email2@example.com' },
        priority: 0,
      },
    );
    const smsJobId = await queue.addJob<{ sms: { to: string } }, 'sms'>(pool, {
      jobType: 'sms',
      payload: { to: 'sms@example.com' },
      priority: 0,
    });

    // Edit only email jobs
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string }; sms: { to: string } },
      'email'
    >(
      pool,
      { jobType: 'email' },
      {
        priority: 5,
      },
    );
    expect(editedCount).toBeGreaterThanOrEqual(2);

    const emailJob1 = await queue.getJob(pool, emailJobId1);
    const emailJob2 = await queue.getJob(pool, emailJobId2);
    const smsJob = await queue.getJob(pool, smsJobId);
    expect(emailJob1?.priority).toBe(5);
    expect(emailJob2?.priority).toBe(5);
    expect(smsJob?.priority).toBe(0);
  });

  it('should edit pending jobs filtered by priority', async () => {
    const lowPriorityJobId1 = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'low1@example.com' },
      priority: 1,
    });
    const lowPriorityJobId2 = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'low2@example.com' },
      priority: 1,
    });
    const highPriorityJobId = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'high@example.com' },
      priority: 10,
    });

    // Edit only low priority jobs
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(
      pool,
      { priority: 1 },
      {
        priority: 5,
      },
    );
    expect(editedCount).toBeGreaterThanOrEqual(2);

    const lowJob1 = await queue.getJob(pool, lowPriorityJobId1);
    const lowJob2 = await queue.getJob(pool, lowPriorityJobId2);
    const highJob = await queue.getJob(pool, highPriorityJobId);
    expect(lowJob1?.priority).toBe(5);
    expect(lowJob2?.priority).toBe(5);
    expect(highJob?.priority).toBe(10);
  });

  it('should edit pending jobs filtered by tags', async () => {
    const taggedJobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'tagged1@example.com' },
        tags: ['urgent', 'priority'],
      },
    );
    const taggedJobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'tagged2@example.com' },
        tags: ['urgent', 'priority'],
      },
    );
    const untaggedJobId = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'untagged@example.com' },
      tags: ['other'],
    });

    // Edit only jobs with 'urgent' tag
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(
      pool,
      { tags: { values: ['urgent'], mode: 'any' } },
      {
        priority: 10,
      },
    );
    expect(editedCount).toBeGreaterThanOrEqual(2);

    const taggedJob1 = await queue.getJob(pool, taggedJobId1);
    const taggedJob2 = await queue.getJob(pool, taggedJobId2);
    const untaggedJob = await queue.getJob(pool, untaggedJobId);
    expect(taggedJob1?.priority).toBe(10);
    expect(taggedJob2?.priority).toBe(10);
    expect(untaggedJob?.priority).toBe(0);
  });

  it('should edit pending jobs filtered by runAt', async () => {
    const futureDate = new Date(Date.now() + 60000);
    const pastDate = new Date(Date.now() - 60000);

    const futureJobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future1@example.com' },
        runAt: futureDate,
      },
    );
    const futureJobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future2@example.com' },
        runAt: futureDate,
      },
    );
    const pastJobId = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: pastDate,
      },
    );

    // Edit only jobs scheduled in the future
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(
      pool,
      { runAt: { gte: new Date() } },
      {
        priority: 10,
      },
    );
    expect(editedCount).toBeGreaterThanOrEqual(2);

    const futureJob1 = await queue.getJob(pool, futureJobId1);
    const futureJob2 = await queue.getJob(pool, futureJobId2);
    const pastJob = await queue.getJob(pool, pastJobId);
    expect(futureJob1?.priority).toBe(10);
    expect(futureJob2?.priority).toBe(10);
    expect(pastJob?.priority).toBe(0);
  });

  it('should not edit non-pending jobs', async () => {
    // Create processingJobId first so it gets picked up by getNextBatch
    const processingJobId = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'processing@example.com' },
      priority: 0,
    });
    const pendingJobId = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'pending@example.com' },
        priority: 0,
      },
    );
    // Mark as processing (this will pick up processingJobId since it was created first)
    await queue.getNextBatch(pool, 'worker-batch', 1);
    const completedJobId = await queue.addJob<
      { email: { to: string } },
      'email'
    >(pool, {
      jobType: 'email',
      payload: { to: 'completed@example.com' },
      priority: 0,
    });
    // Set to completed via SQL (bypassing status check since we're testing edit behavior)
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [completedJobId],
    );

    // Edit all pending jobs
    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(pool, undefined, {
      priority: 10,
    });

    const pendingJob = await queue.getJob(pool, pendingJobId);
    const processingJob = await queue.getJob(pool, processingJobId);
    const completedJob = await queue.getJob(pool, completedJobId);
    expect(pendingJob?.priority).toBe(10);
    expect(processingJob?.priority).toBe(0);
    expect(completedJob?.priority).toBe(0);
    expect(editedCount).toBeGreaterThanOrEqual(1);
  });

  it('should record edit events for each edited job', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'event1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'event2@example.com' },
      },
    );

    await queue.editAllPendingJobs<{ email: { to: string } }, 'email'>(
      pool,
      undefined,
      {
        priority: 10,
      },
    );

    const events1 = await queue.getJobEvents(pool, jobId1);
    const events2 = await queue.getJobEvents(pool, jobId2);
    const editEvent1 = events1.find((e) => e.eventType === JobEventType.Edited);
    const editEvent2 = events2.find((e) => e.eventType === JobEventType.Edited);
    expect(editEvent1).not.toBeUndefined();
    expect(editEvent2).not.toBeUndefined();
    expect(editEvent1?.metadata).toMatchObject({ priority: 10 });
    expect(editEvent2?.metadata).toMatchObject({ priority: 10 });
  });

  it('should return 0 when no fields to update', async () => {
    await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'empty@example.com' },
    });

    const editedCount = await queue.editAllPendingJobs<
      { email: { to: string } },
      'email'
    >(pool, undefined, {});

    expect(editedCount).toBe(0);
  });

  it('should cancel all upcoming jobs', async () => {
    // Add three pending jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancelall1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancelall2@example.com' },
      },
    );
    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancelall3@example.com' },
      },
    );
    // Add a completed job (set via SQL since this test is about cancel behavior)
    const jobId4 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'done@example.com' },
      },
    );
    await pool.query(
      `UPDATE job_queue SET status = 'completed' WHERE id = $1`,
      [jobId4],
    );

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

  it('should store and retrieve runAt in UTC without timezone shift', async () => {
    const utcDate = new Date(Date.UTC(2030, 0, 1, 12, 0, 0, 0)); // 2030-01-01T12:00:00.000Z
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'utc@example.com' },
      runAt: utcDate,
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    // The runAt value should match exactly (toISOString) what we inserted
    expect(job?.runAt.toISOString()).toBe(utcDate.toISOString());
  });

  it('should get all jobs', async () => {
    // Add three jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'all1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ sms: { to: string } }, 'sms'>(pool, {
      jobType: 'sms',
      payload: { to: 'all2@example.com' },
    });
    const jobId3 = await queue.addJob<{ push: { to: string } }, 'push'>(pool, {
      jobType: 'push',
      payload: { to: 'all3@example.com' },
    });
    // Get all jobs
    const jobs = await queue.getAllJobs(pool);
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain(jobId1);
    expect(ids).toContain(jobId2);
    expect(ids).toContain(jobId3);
    // Should return correct job data
    const job1 = jobs.find((j) => j.id === jobId1);
    expect(job1?.jobType).toBe('email');
    expect(job1?.payload).toEqual({ to: 'all1@example.com' });
  });

  it('should support pagination in getAllJobs', async () => {
    // Add four jobs
    await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
    });
    await queue.addJob<{ b: { n: number } }, 'b'>(pool, {
      jobType: 'b',
      payload: { n: 2 },
    });
    await queue.addJob<{ c: { n: number } }, 'c'>(pool, {
      jobType: 'c',
      payload: { n: 3 },
    });
    await queue.addJob<{ d: { n: number } }, 'd'>(pool, {
      jobType: 'd',
      payload: { n: 4 },
    });
    // Get first two jobs
    const firstTwo = await queue.getAllJobs(pool, 2, 0);
    expect(firstTwo.length).toBe(2);
    // Get next two jobs
    const nextTwo = await queue.getAllJobs(pool, 2, 2);
    expect(nextTwo.length).toBe(2);
    // No overlap in IDs
    const firstIds = firstTwo.map((j) => j.id);
    const nextIds = nextTwo.map((j) => j.id);
    expect(firstIds.some((id) => nextIds.includes(id))).toBe(false);
  });

  it('should track error history for failed jobs', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'failhistory@example.com' },
    });
    // Claim and fail the job (first error)
    await queue.getNextBatch(pool, 'worker-fail-1', 1);
    await queue.failJob(pool, jobId, new Error('first error'));
    // Retry, claim again, and fail again (second error)
    await queue.retryJob(pool, jobId);
    await queue.getNextBatch(pool, 'worker-fail-2', 1);
    await queue.failJob(pool, jobId, new Error('second error'));
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('failed');
    expect(Array.isArray(job?.errorHistory)).toBe(true);
    expect(job?.errorHistory?.length).toBeGreaterThanOrEqual(2);
    expect(job?.errorHistory?.[0].message).toBe('first error');
    expect(job?.errorHistory?.[1].message).toBe('second error');
    expect(typeof job?.errorHistory?.[0].timestamp).toBe('string');
    expect(typeof job?.errorHistory?.[1].timestamp).toBe('string');
  });

  it('should reclaim stuck processing jobs', async () => {
    // Add a job and set it to processing with an old locked_at
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'stuck@example.com' },
    });
    await pool.query(
      `UPDATE job_queue SET status = 'processing', locked_at = NOW() - INTERVAL '15 minutes' WHERE id = $1`,
      [jobId],
    );
    // Should be processing and locked_at is old
    let job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('processing');
    // Reclaim stuck jobs (threshold 10 minutes)
    const reclaimed = await queue.reclaimStuckJobs(pool, 10);
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('pending');
    expect(job?.lockedAt).toBeNull();
    expect(job?.lockedBy).toBeNull();
  });

  it('should not reclaim a job whose timeoutMs exceeds the reclaim threshold', async () => {
    // Add a job with a 30-minute timeout
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'long-timeout@example.com' },
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    });
    // Simulate: processing for 15 minutes (exceeds 10-min global threshold but within 30-min job timeout)
    await pool.query(
      `UPDATE job_queue SET status = 'processing', locked_at = NOW() - INTERVAL '15 minutes' WHERE id = $1`,
      [jobId],
    );
    let job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('processing');

    // Reclaim with 10-minute global threshold — should NOT reclaim this job
    const reclaimed = await queue.reclaimStuckJobs(pool, 10);
    expect(reclaimed).toBe(0);
    job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('processing');
  });

  it('should reclaim a job whose timeoutMs has also been exceeded', async () => {
    // Add a job with a 20-minute timeout
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'expired-timeout@example.com' },
      timeoutMs: 20 * 60 * 1000, // 20 minutes
    });
    // Simulate: processing for 25 minutes (exceeds both 10-min threshold and 20-min job timeout)
    await pool.query(
      `UPDATE job_queue SET status = 'processing', locked_at = NOW() - INTERVAL '25 minutes' WHERE id = $1`,
      [jobId],
    );
    let job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('processing');

    // Reclaim with 10-minute global threshold — should reclaim since 25 min > 20 min timeout
    const reclaimed = await queue.reclaimStuckJobs(pool, 10);
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('pending');
  });
});

describe('job event tracking', () => {
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

  async function getEvents(jobId: number) {
    const res = await pool.query(
      'SELECT * FROM job_events WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId],
    );
    return res.rows.map((row) => objectKeysToCamelCase(row) as JobEvent);
  }

  it('records added and processing events', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'event1@example.com' },
    });
    // Pick up for processing
    await queue.getNextBatch(pool, 'worker-evt', 1);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.eventType)).toEqual([
      JobEventType.Added,
      JobEventType.Processing,
    ]);
  });

  it('records completed event', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'event2@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-evt', 1);
    await queue.completeJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.eventType)).toContain(JobEventType.Completed);
  });

  it('records failed and retried events', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'event3@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-evt', 1);
    await queue.failJob(pool, jobId, new Error('fail for event'));
    await queue.retryJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([JobEventType.Failed, JobEventType.Retried]),
    );
    const failEvent = events.find((e) => e.eventType === JobEventType.Failed);
    expect(failEvent?.metadata).toMatchObject({ message: 'fail for event' });
  });

  it('records cancelled event', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'event4@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.eventType)).toContain(JobEventType.Cancelled);
  });
});

describe('job lifecycle timestamp columns', () => {
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

  async function getJobRow(jobId: number) {
    const res = await pool.query('SELECT * FROM job_queue WHERE id = $1', [
      jobId,
    ]);
    return res.rows[0];
  }

  it('sets startedAt when job is picked up for processing', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts1@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.startedAt).not.toBeNull();
  });

  it('sets completedAt when job is completed', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts2@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.completeJob(pool, jobId);
    const job = await getJobRow(jobId);
    expect(job.completedAt).not.toBeNull();
  });

  it('sets lastFailedAt when job fails', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts3@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.failJob(pool, jobId, new Error('fail for ts'));
    const job = await getJobRow(jobId);
    expect(job.lastFailedAt).not.toBeNull();
  });

  it('sets lastRetriedAt when job is retried', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts4@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.failJob(pool, jobId, new Error('fail for ts retry'));
    // Make the job eligible for retry immediately
    await pool.query(
      'UPDATE job_queue SET next_attempt_at = NOW() WHERE id = $1',
      [jobId],
    );
    // Pick up for processing again (should increment attempts and set lastRetriedAt)
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.lastRetriedAt).not.toBeNull();
  });

  it('sets lastCancelledAt when job is cancelled', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts5@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const job = await getJobRow(jobId);
    expect(job.lastCancelledAt).not.toBeNull();
  });

  it('sets lastRetriedAt when job is picked up for processing again (attempts > 0)', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'ts6@example.com' },
    });
    // First pick up and fail the job
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.failJob(pool, jobId, new Error('fail for ts retry'));
    // Make the job eligible for retry immediately
    await pool.query(
      'UPDATE job_queue SET next_attempt_at = NOW() WHERE id = $1',
      [jobId],
    );
    // Pick up for processing again (should increment attempts and set lastRetriedAt)
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.lastRetriedAt).not.toBeNull();
  });
});

describe('tags feature', () => {
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

  it('should add a job with tags and retrieve it by tags (all mode)', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'tagged@example.com' },
      tags: ['welcome', 'user:1'],
    });
    const jobs = await queue.getJobsByTags(pool, ['welcome'], 'all');
    expect(jobs.map((j) => j.id)).toContain(jobId);
    expect(jobs[0].tags).toContain('welcome');
    expect(jobs[0].tags).toContain('user:1');
  });

  it('should only return jobs that match all specified tags (all mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
        tags: ['foo', 'bar'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'b@example.com' },
        tags: ['foo'],
      },
    );

    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'c@example.com' },
        tags: ['foo', 'bar', 'baz'],
      },
    );
    const jobs = await queue.getJobsByTags(pool, ['foo', 'bar'], 'all');
    expect(jobs.map((j) => j.id)).toContain(jobId1);
    expect(jobs.map((j) => j.id)).not.toContain(jobId2);
    expect(jobs.map((j) => j.id)).toContain(jobId3);
  });

  it('should return jobs with exactly the same tags (exact mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
        tags: ['foo', 'bar'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'b@example.com' },
        tags: ['foo', 'bar', 'baz'],
      },
    );
    const jobs = await queue.getJobsByTags(pool, ['foo', 'bar'], 'exact');
    expect(jobs.map((j) => j.id)).toContain(jobId1);
    expect(jobs.map((j) => j.id)).not.toContain(jobId2);
  });

  it('should return jobs that have any of the given tags (any mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
        tags: ['foo', 'bar'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'b@example.com' },
        tags: ['baz'],
      },
    );
    const jobs = await queue.getJobsByTags(pool, ['bar', 'baz'], 'any');
    expect(jobs.map((j) => j.id)).toContain(jobId1);
    expect(jobs.map((j) => j.id)).toContain(jobId2);
  });

  it('should return jobs that have none of the given tags (none mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
        tags: ['foo'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'b@example.com' },
        tags: ['bar'],
      },
    );
    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'c@example.com' },
        tags: ['baz'],
      },
    );
    const jobs = await queue.getJobsByTags(pool, ['foo', 'bar'], 'none');
    expect(jobs.map((j) => j.id)).toContain(jobId3);
    expect(jobs.map((j) => j.id)).not.toContain(jobId1);
    expect(jobs.map((j) => j.id)).not.toContain(jobId2);
  });

  it('should handle jobs with no tags', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'notag@example.com' },
    });
    const jobs = await queue.getJobsByTags(pool, ['anytag'], 'all');
    expect(jobs.map((j) => j.id)).not.toContain(jobId);
  });

  it('should cancel jobs by tags (all mode)', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'cancelme@example.com' },
      tags: ['cancel', 'urgent'],
    });
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      tags: { values: ['cancel', 'urgent'], mode: 'all' },
    });
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('cancelled');
  });

  it('should cancel jobs by tags (exact mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel1@example.com' },
        tags: ['cancel', 'urgent'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel2@example.com' },
        tags: ['cancel', 'urgent', 'other'],
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      tags: { values: ['cancel', 'urgent'], mode: 'exact' },
    });
    expect(cancelled).toBe(1);
    const job1 = await queue.getJob(pool, jobId1);
    const job2 = await queue.getJob(pool, jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('pending');
  });

  it('should cancel jobs by tags (any mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel1@example.com' },
        tags: ['cancel', 'urgent'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel2@example.com' },
        tags: ['other'],
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      tags: { values: ['cancel', 'other'], mode: 'any' },
    });
    expect(cancelled).toBe(2);
    const job1 = await queue.getJob(pool, jobId1);
    const job2 = await queue.getJob(pool, jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('cancelled');
  });

  it('should cancel jobs by tags (none mode)', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel1@example.com' },
        tags: ['foo'],
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'cancel2@example.com' },
        tags: ['bar'],
      },
    );
    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'keep@example.com' },
        tags: ['baz'],
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      tags: { values: ['foo', 'bar'], mode: 'none' },
    });
    expect(cancelled).toBe(1);
    const job1 = await queue.getJob(pool, jobId1);
    const job2 = await queue.getJob(pool, jobId2);
    const job3 = await queue.getJob(pool, jobId3);
    expect(job1?.status).toBe('pending');
    expect(job2?.status).toBe('pending');
    expect(job3?.status).toBe('cancelled');
  });
});

describe('cancelAllUpcomingJobs with runAt object filter', () => {
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

  it('should cancel jobs with runAt > filter (gt)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      runAt: { gt: now },
    });
    expect(cancelled).toBe(1);
    const jobPast = await queue.getJob(pool, jobIdPast);
    const jobNow = await queue.getJob(pool, jobIdNow);
    const jobFuture = await queue.getJob(pool, jobIdFuture);
    expect(jobPast?.status).toBe('pending');
    expect(jobNow?.status).toBe('pending');
    expect(jobFuture?.status).toBe('cancelled');
  });

  it('should cancel jobs with runAt >= filter (gte)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      runAt: { gte: now },
    });
    expect(cancelled).toBe(2);
    const jobPast = await queue.getJob(pool, jobIdPast);
    const jobNow = await queue.getJob(pool, jobIdNow);
    const jobFuture = await queue.getJob(pool, jobIdFuture);
    expect(jobPast?.status).toBe('pending');
    expect(jobNow?.status).toBe('cancelled');
    expect(jobFuture?.status).toBe('cancelled');
  });

  it('should cancel jobs with runAt < filter (lt)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      runAt: { lt: now },
    });
    expect(cancelled).toBe(1);
    const jobPast = await queue.getJob(pool, jobIdPast);
    const jobNow = await queue.getJob(pool, jobIdNow);
    const jobFuture = await queue.getJob(pool, jobIdFuture);
    expect(jobPast?.status).toBe('cancelled');
    expect(jobNow?.status).toBe('pending');
    expect(jobFuture?.status).toBe('pending');
  });

  it('should cancel jobs with runAt <= filter (lte)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      runAt: { lte: now },
    });
    expect(cancelled).toBe(2);
    const jobPast = await queue.getJob(pool, jobIdPast);
    const jobNow = await queue.getJob(pool, jobIdNow);
    const jobFuture = await queue.getJob(pool, jobIdFuture);
    expect(jobPast?.status).toBe('cancelled');
    expect(jobNow?.status).toBe('cancelled');
    expect(jobFuture?.status).toBe('pending');
  });

  it('should cancel jobs with runAt eq filter (eq)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    const cancelled = await queue.cancelAllUpcomingJobs(pool, {
      runAt: { eq: now },
    });
    expect(cancelled).toBe(1);
    const jobPast = await queue.getJob(pool, jobIdPast);
    const jobNow = await queue.getJob(pool, jobIdNow);
    const jobFuture = await queue.getJob(pool, jobIdFuture);
    expect(jobPast?.status).toBe('pending');
    expect(jobNow?.status).toBe('cancelled');
    expect(jobFuture?.status).toBe('pending');
  });
});

describe('getJobs', () => {
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

  it('should filter by jobType', async () => {
    const id1 = await queue.addJob<{ a: { n: number }; b: { n: number } }, 'a'>(
      pool,
      { jobType: 'a', payload: { n: 1 } },
    );
    const id2 = await queue.addJob<{ a: { n: number }; b: { n: number } }, 'b'>(
      pool,
      { jobType: 'b', payload: { n: 2 } },
    );
    const jobs = await queue.getJobs(pool, { jobType: 'a' });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  it('should filter by priority', async () => {
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      priority: 1,
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      priority: 2,
    });
    const jobs = await queue.getJobs(pool, { priority: 2 });
    expect(jobs.map((j) => j.id)).toContain(id2);
    expect(jobs.map((j) => j.id)).not.toContain(id1);
  });

  it('should filter by runAt', async () => {
    const runAt = new Date(Date.UTC(2030, 0, 1, 12, 0, 0, 0));
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      runAt,
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
    });
    const jobs = await queue.getJobs(pool, { runAt });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  it('should filter jobs using runAt with gt/gte/lt/lte/eq', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day ahead
    const jobIdPast = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'past@example.com' },
        runAt: past,
      },
    );
    const jobIdNow = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'now@example.com' },
        runAt: now,
      },
    );
    const jobIdFuture = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'future@example.com' },
        runAt: future,
      },
    );
    // eq
    let jobs = await queue.getJobs(pool, { runAt: now });
    expect(jobs.map((j) => j.id)).toContain(jobIdNow);
    // gt
    jobs = await queue.getJobs(pool, { runAt: { gt: now } });
    expect(jobs.map((j) => j.id)).toContain(jobIdFuture);
    expect(jobs.map((j) => j.id)).not.toContain(jobIdNow);
    // gte
    jobs = await queue.getJobs(pool, { runAt: { gte: now } });
    expect(jobs.map((j) => j.id)).toContain(jobIdNow);
    expect(jobs.map((j) => j.id)).toContain(jobIdFuture);
    // lt
    jobs = await queue.getJobs(pool, { runAt: { lt: now } });
    expect(jobs.map((j) => j.id)).toContain(jobIdPast);
    expect(jobs.map((j) => j.id)).not.toContain(jobIdNow);
    // lte
    jobs = await queue.getJobs(pool, { runAt: { lte: now } });
    expect(jobs.map((j) => j.id)).toContain(jobIdPast);
    expect(jobs.map((j) => j.id)).toContain(jobIdNow);
  });

  it('should filter by tags (all mode)', async () => {
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      tags: ['foo', 'bar'],
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      tags: ['foo'],
    });
    const jobs = await queue.getJobs(pool, {
      tags: { values: ['foo', 'bar'], mode: 'all' },
    });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  it('should filter by tags (any mode)', async () => {
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      tags: ['foo'],
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      tags: ['bar'],
    });
    const jobs = await queue.getJobs(pool, {
      tags: { values: ['foo', 'bar'], mode: 'any' },
    });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).toContain(id2);
  });

  it('should filter by tags (exact mode)', async () => {
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      tags: ['foo', 'bar'],
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      tags: ['foo', 'bar', 'baz'],
    });
    const jobs = await queue.getJobs(pool, {
      tags: { values: ['foo', 'bar'], mode: 'exact' },
    });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  it('should filter by tags (none mode)', async () => {
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      tags: ['foo'],
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      tags: ['bar'],
    });
    const id3 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 3 },
      tags: ['baz'],
    });
    const jobs = await queue.getJobs(pool, {
      tags: { values: ['foo', 'bar'], mode: 'none' },
    });
    expect(jobs.map((j) => j.id)).toContain(id3);
    expect(jobs.map((j) => j.id)).not.toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  it('should support pagination', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
          jobType: 'a',
          payload: { n: i },
        }),
      );
    }
    const firstTwo = await queue.getJobs(pool, {}, 2, 0);
    const nextTwo = await queue.getJobs(pool, {}, 2, 2);
    expect(firstTwo.length).toBe(2);
    expect(nextTwo.length).toBe(2);
    const firstIds = firstTwo.map((j) => j.id);
    const nextIds = nextTwo.map((j) => j.id);
    expect(firstIds.some((id) => nextIds.includes(id))).toBe(false);
  });

  it('should filter by a combination of filters', async () => {
    const runAt = new Date(Date.UTC(2030, 0, 1, 12, 0, 0, 0));
    const id1 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 1 },
      priority: 1,
      runAt,
      tags: ['foo', 'bar'],
    });
    const id2 = await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      jobType: 'a',
      payload: { n: 2 },
      priority: 2,
      tags: ['foo'],
    });
    const jobs = await queue.getJobs(pool, {
      jobType: 'a',
      priority: 1,
      runAt,
      tags: { values: ['foo', 'bar'], mode: 'all' },
    });
    expect(jobs.map((j) => j.id)).toContain(id1);
    expect(jobs.map((j) => j.id)).not.toContain(id2);
  });

  // --- Idempotency tests ---

  it('should store and return idempotencyKey when provided', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'test@example.com' },
      idempotencyKey: 'unique-key-1',
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.idempotencyKey).toBe('unique-key-1');
  });

  it('should return the same job ID when adding a job with a duplicate idempotencyKey', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'first@example.com' },
        idempotencyKey: 'dedup-key',
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'second@example.com' },
        idempotencyKey: 'dedup-key',
      },
    );
    expect(jobId1).toBe(jobId2);

    // The original job's payload should be preserved (not updated)
    const job = await queue.getJob(pool, jobId1);
    expect(job?.payload).toEqual({ to: 'first@example.com' });
  });

  it('should create separate jobs when no idempotencyKey is provided', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'a@example.com' },
      },
    );
    expect(jobId1).not.toBe(jobId2);
  });

  it('should create separate jobs when different idempotencyKeys are provided', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'same@example.com' },
        idempotencyKey: 'key-a',
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'same@example.com' },
        idempotencyKey: 'key-b',
      },
    );
    expect(jobId1).not.toBe(jobId2);
  });

  it('should only record the added event once for duplicate idempotencyKey', async () => {
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
        payload: { to: 'once@example.com' },
        idempotencyKey: 'event-dedup-key',
      },
    );
    // Add again with same key
    await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'twice@example.com' },
      idempotencyKey: 'event-dedup-key',
    });

    const events = await queue.getJobEvents(pool, jobId1);
    const addedEvents = events.filter(
      (e: JobEvent) => e.eventType === JobEventType.Added,
    );
    expect(addedEvents.length).toBe(1);
  });

  it('should return null idempotencyKey for jobs created without one', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'nokey@example.com' },
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.idempotencyKey).toBeNull();
  });

  it('should permanently fail a job when max attempts are exhausted', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'exhaust@example.com' },
      maxAttempts: 2,
    });

    // Claim the job (attempt 1)
    const batch1 = await queue.getNextBatch(pool, 'worker-1', 1);
    expect(batch1.length).toBe(1);
    expect(batch1[0].attempts).toBe(1);

    // Fail it
    await queue.failJob(pool, jobId, new Error('attempt 1 failed'));
    let job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('failed');
    expect(job?.nextAttemptAt).not.toBeNull(); // Should have a retry scheduled

    // Wait a moment so next_attempt_at <= NOW() and claim again (attempt 2)
    await pool.query(
      `UPDATE job_queue SET next_attempt_at = NOW() WHERE id = $1`,
      [jobId],
    );
    const batch2 = await queue.getNextBatch(pool, 'worker-1', 1);
    expect(batch2.length).toBe(1);
    expect(batch2[0].attempts).toBe(2);

    // Fail it again — now attempts === maxAttempts
    await queue.failJob(pool, jobId, new Error('attempt 2 failed'));
    job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('failed');
    expect(job?.nextAttemptAt).toBeNull(); // No more retries
    expect(job?.errorHistory?.length).toBe(2);

    // Should NOT be picked up again
    const batch3 = await queue.getNextBatch(pool, 'worker-1', 1);
    expect(batch3.length).toBe(0);
  });

  // ── Configurable retry strategy tests ────────────────────────────────

  it('uses legacy backoff when no retry config is set', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'legacy@example.com' },
      maxAttempts: 3,
    });

    // Act
    await queue.getNextBatch(pool, 'worker-1', 1);
    await queue.failJob(pool, jobId, new Error('fail'));

    // Assert — legacy formula: 2^1 * 60s = 120s from now
    const job = await queue.getJob(pool, jobId);
    expect(job?.nextAttemptAt).not.toBeNull();
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(115);
    expect(delaySec).toBeLessThanOrEqual(125);
  });

  it('uses fixed delay when retryBackoff is false', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'fixed@example.com' },
      maxAttempts: 3,
      retryDelay: 10,
      retryBackoff: false,
    });

    // Act
    await queue.getNextBatch(pool, 'worker-1', 1);
    await queue.failJob(pool, jobId, new Error('fail'));

    // Assert — fixed 10s delay
    const job = await queue.getJob(pool, jobId);
    expect(job?.nextAttemptAt).not.toBeNull();
    expect(job?.retryDelay).toBe(10);
    expect(job?.retryBackoff).toBe(false);
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(9);
    expect(delaySec).toBeLessThanOrEqual(11);
  });

  it('uses exponential backoff with custom retryDelay', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'expo@example.com' },
      maxAttempts: 3,
      retryDelay: 5,
      retryBackoff: true,
    });

    // Act — attempt 1
    await queue.getNextBatch(pool, 'worker-1', 1);
    await queue.failJob(pool, jobId, new Error('fail'));

    // Assert — exponential: 5 * 2^1 = 10s, with jitter [5, 10]
    const job = await queue.getJob(pool, jobId);
    expect(job?.nextAttemptAt).not.toBeNull();
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(4);
    expect(delaySec).toBeLessThanOrEqual(11);
  });

  it('caps exponential backoff with retryDelayMax', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'capped@example.com' },
      maxAttempts: 5,
      retryDelay: 100,
      retryBackoff: true,
      retryDelayMax: 30,
    });

    // Act — attempt 1
    await queue.getNextBatch(pool, 'worker-1', 1);
    await queue.failJob(pool, jobId, new Error('fail'));

    // Assert — 100 * 2^1 = 200s but capped at 30s, with jitter [15, 30]
    const job = await queue.getJob(pool, jobId);
    expect(job?.nextAttemptAt).not.toBeNull();
    expect(job?.retryDelayMax).toBe(30);
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(14);
    expect(delaySec).toBeLessThanOrEqual(31);
  });

  it('stores retry config on job record', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'config@example.com' },
      retryDelay: 30,
      retryBackoff: false,
      retryDelayMax: 120,
    });

    // Act
    const job = await queue.getJob(pool, jobId);

    // Assert
    expect(job?.retryDelay).toBe(30);
    expect(job?.retryBackoff).toBe(false);
    expect(job?.retryDelayMax).toBe(120);
  });

  it('returns null retry config for jobs without it', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'noconfig@example.com' },
    });

    // Act
    const job = await queue.getJob(pool, jobId);

    // Assert
    expect(job?.retryDelay).toBeNull();
    expect(job?.retryBackoff).toBeNull();
    expect(job?.retryDelayMax).toBeNull();
  });

  it('allows editing retry config via editJob', async () => {
    // Setup
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      jobType: 'email',
      payload: { to: 'edit@example.com' },
    });

    // Act
    await queue.editJob(pool, jobId, {
      retryDelay: 15,
      retryBackoff: false,
      retryDelayMax: 60,
    });

    // Assert
    const job = await queue.getJob(pool, jobId);
    expect(job?.retryDelay).toBe(15);
    expect(job?.retryBackoff).toBe(false);
    expect(job?.retryDelayMax).toBe(60);
  });
});

describe('queue.addJob with db option (BYOC)', () => {
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

  it('rolls back the job when the transaction is rolled back', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      { jobType: 'email', payload: { to: 'rollback@example.com' } },
      { db: client },
    );
    await client.query('ROLLBACK');
    client.release();

    // Assert
    const job = await queue.getJob(pool, jobId);
    expect(job).toBeNull();
  });

  it('persists the job when the transaction is committed', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      { jobType: 'email', payload: { to: 'commit@example.com' } },
      { db: client },
    );
    await client.query('COMMIT');
    client.release();

    // Assert
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    expect(job?.payload).toEqual({ to: 'commit@example.com' });
  });
});

describe('addJobs batch insert', () => {
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

  it('inserts multiple jobs and returns IDs in order', async () => {
    // Act
    const ids = await queue.addJobs<
      { email: { to: string }; report: { id: string } },
      'email' | 'report'
    >(pool, [
      { jobType: 'email', payload: { to: 'a@test.com' } },
      { jobType: 'report', payload: { id: 'r1' } },
      { jobType: 'email', payload: { to: 'b@test.com' } },
    ]);

    // Assert
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBeLessThan(ids[1]);
    expect(ids[1]).toBeLessThan(ids[2]);

    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0?.jobType).toBe('email');
    expect(job0?.payload).toEqual({ to: 'a@test.com' });

    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1?.jobType).toBe('report');
    expect(job1?.payload).toEqual({ id: 'r1' });

    const job2 = await queue.getJob(pool, ids[2]);
    expect(job2?.jobType).toBe('email');
    expect(job2?.payload).toEqual({ to: 'b@test.com' });
  });

  it('returns empty array for empty input', async () => {
    // Act
    const ids = await queue.addJobs(pool, []);

    // Assert
    expect(ids).toEqual([]);
  });

  it('respects priority and runAt per job', async () => {
    // Setup
    const futureDate = new Date(Date.now() + 60_000);

    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 }, priority: 5 },
      { jobType: 'task', payload: { n: 2 }, priority: 10, runAt: futureDate },
    ]);

    // Assert
    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0?.priority).toBe(5);

    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1?.priority).toBe(10);
    expect(job1?.runAt.getTime()).toBeCloseTo(futureDate.getTime(), -3);
  });

  it('handles idempotency keys for new jobs', async () => {
    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 }, idempotencyKey: 'key-a' },
      { jobType: 'task', payload: { n: 2 }, idempotencyKey: 'key-b' },
    ]);

    // Assert
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0?.idempotencyKey).toBe('key-a');

    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1?.idempotencyKey).toBe('key-b');
  });

  it('returns existing IDs for conflicting idempotency keys', async () => {
    // Setup — insert a job first
    const existingId = await queue.addJob<{ task: { n: number } }, 'task'>(
      pool,
      { jobType: 'task', payload: { n: 0 }, idempotencyKey: 'dup-key' },
    );

    // Act — batch includes a duplicate key
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 } },
      { jobType: 'task', payload: { n: 2 }, idempotencyKey: 'dup-key' },
      { jobType: 'task', payload: { n: 3 } },
    ]);

    // Assert
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(existingId);
    expect(ids[0]).not.toBe(existingId);
    expect(ids[2]).not.toBe(existingId);
  });

  it('handles mix of keyed and non-keyed jobs', async () => {
    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 } },
      { jobType: 'task', payload: { n: 2 }, idempotencyKey: 'mix-1' },
      { jobType: 'task', payload: { n: 3 } },
      { jobType: 'task', payload: { n: 4 }, idempotencyKey: 'mix-2' },
      { jobType: 'task', payload: { n: 5 } },
    ]);

    // Assert
    expect(ids).toHaveLength(5);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5);

    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1?.idempotencyKey).toBe('mix-1');

    const job3 = await queue.getJob(pool, ids[3]);
    expect(job3?.idempotencyKey).toBe('mix-2');
  });

  it('records added events only for newly inserted jobs', async () => {
    // Setup — pre-insert a job with a known key
    const existingId = await queue.addJob<{ task: { n: number } }, 'task'>(
      pool,
      { jobType: 'task', payload: { n: 0 }, idempotencyKey: 'evt-key' },
    );

    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 } },
      { jobType: 'task', payload: { n: 2 }, idempotencyKey: 'evt-key' },
    ]);

    // Assert — the new job should have an event from addJobs
    const events0 = await queue.getJobEvents(pool, ids[0]);
    const addedEvents0 = events0.filter(
      (e: JobEvent) => e.eventType === JobEventType.Added,
    );
    expect(addedEvents0).toHaveLength(1);

    // The duplicate should only have the original event from addJob, not a second from addJobs
    const eventsExisting = await queue.getJobEvents(pool, existingId);
    const addedEventsExisting = eventsExisting.filter(
      (e: JobEvent) => e.eventType === JobEventType.Added,
    );
    expect(addedEventsExisting).toHaveLength(1);
  });

  it('stores tags correctly per job', async () => {
    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(pool, [
      { jobType: 'task', payload: { n: 1 }, tags: ['urgent', 'billing'] },
      { jobType: 'task', payload: { n: 2 }, tags: ['low-priority'] },
      { jobType: 'task', payload: { n: 3 } },
    ]);

    // Assert
    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0?.tags).toEqual(['urgent', 'billing']);

    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1?.tags).toEqual(['low-priority']);

    const job2 = await queue.getJob(pool, ids[2]);
    expect(job2?.tags).toBeNull();
  });

  it('works with transactional db option — commit', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(
      pool,
      [
        { jobType: 'task', payload: { n: 1 } },
        { jobType: 'task', payload: { n: 2 } },
      ],
      { db: client },
    );
    await client.query('COMMIT');
    client.release();

    // Assert
    expect(ids).toHaveLength(2);
    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0).not.toBeNull();
    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1).not.toBeNull();
  });

  it('works with transactional db option — rollback', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const ids = await queue.addJobs<{ task: { n: number } }, 'task'>(
      pool,
      [
        { jobType: 'task', payload: { n: 1 } },
        { jobType: 'task', payload: { n: 2 } },
      ],
      { db: client },
    );
    await client.query('ROLLBACK');
    client.release();

    // Assert — jobs should not exist after rollback
    const job0 = await queue.getJob(pool, ids[0]);
    expect(job0).toBeNull();
    const job1 = await queue.getJob(pool, ids[1]);
    expect(job1).toBeNull();
  });
});
