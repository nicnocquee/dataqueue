import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as queue from './queue.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { JobEventType } from './types.js';

// Example integration test setup

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
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'a@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ sms: { to: string } }, 'sms'>(pool, {
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'done@example.com' },
    });
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
  });

  it('should get the next batch of jobs to process', async () => {
    // Add jobs (do not set run_at, use DB default)
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'batch1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
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
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'cancelme@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('cancelled');

    // Try to cancel a job that is already completed
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'done@example.com' },
      },
    );
    await queue.completeJob(pool, jobId2);
    await queue.cancelJob(pool, jobId2);
    const completedJob = await queue.getJob(pool, jobId2);
    expect(completedJob?.status).toBe('completed');
  });

  it('should cancel all upcoming jobs', async () => {
    // Add three pending jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'cancelall1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'cancelall2@example.com' },
      },
    );
    const jobId3 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'cancelall3@example.com' },
      },
    );
    // Add a completed job
    const jobId4 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'done@example.com' },
      },
    );
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

  it('should store and retrieve run_at in UTC without timezone shift', async () => {
    const utcDate = new Date(Date.UTC(2030, 0, 1, 12, 0, 0, 0)); // 2030-01-01T12:00:00.000Z
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'utc@example.com' },
      run_at: utcDate,
    });
    const job = await queue.getJob(pool, jobId);
    expect(job).not.toBeNull();
    // The run_at value should match exactly (toISOString) what we inserted
    expect(job?.run_at.toISOString()).toBe(utcDate.toISOString());
  });

  it('should get all jobs', async () => {
    // Add three jobs
    const jobId1 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        job_type: 'email',
        payload: { to: 'all1@example.com' },
      },
    );
    const jobId2 = await queue.addJob<{ sms: { to: string } }, 'sms'>(pool, {
      job_type: 'sms',
      payload: { to: 'all2@example.com' },
    });
    const jobId3 = await queue.addJob<{ push: { to: string } }, 'push'>(pool, {
      job_type: 'push',
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
    expect(job1?.job_type).toBe('email');
    expect(job1?.payload).toEqual({ to: 'all1@example.com' });
  });

  it('should support pagination in getAllJobs', async () => {
    // Add four jobs
    await queue.addJob<{ a: { n: number } }, 'a'>(pool, {
      job_type: 'a',
      payload: { n: 1 },
    });
    await queue.addJob<{ b: { n: number } }, 'b'>(pool, {
      job_type: 'b',
      payload: { n: 2 },
    });
    await queue.addJob<{ c: { n: number } }, 'c'>(pool, {
      job_type: 'c',
      payload: { n: 3 },
    });
    await queue.addJob<{ d: { n: number } }, 'd'>(pool, {
      job_type: 'd',
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
      job_type: 'email',
      payload: { to: 'failhistory@example.com' },
    });
    // Fail the job twice with different errors
    await queue.failJob(pool, jobId, new Error('first error'));
    await queue.failJob(pool, jobId, new Error('second error'));
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('failed');
    expect(Array.isArray(job?.error_history)).toBe(true);
    expect(job?.error_history?.length).toBeGreaterThanOrEqual(2);
    expect(job?.error_history?.[0].message).toBe('first error');
    expect(job?.error_history?.[1].message).toBe('second error');
    expect(typeof job?.error_history?.[0].timestamp).toBe('string');
    expect(typeof job?.error_history?.[1].timestamp).toBe('string');
  });

  it('should reclaim stuck processing jobs', async () => {
    // Add a job and set it to processing with an old locked_at
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
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
    expect(job?.locked_at).toBeNull();
    expect(job?.locked_by).toBeNull();
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
    return res.rows;
  }

  it('records added and processing events', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'event1@example.com' },
    });
    // Pick up for processing
    await queue.getNextBatch(pool, 'worker-evt', 1);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.event_type)).toEqual([
      JobEventType.Added,
      JobEventType.Processing,
    ]);
  });

  it('records completed event', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'event2@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-evt', 1);
    await queue.completeJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.event_type)).toContain(JobEventType.Completed);
  });

  it('records failed and retried events', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'event3@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-evt', 1);
    await queue.failJob(pool, jobId, new Error('fail for event'));
    await queue.retryJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([JobEventType.Failed, JobEventType.Retried]),
    );
    const failEvent = events.find((e) => e.event_type === JobEventType.Failed);
    expect(failEvent.metadata).toMatchObject({ message: 'fail for event' });
  });

  it('records cancelled event', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'event4@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const events = await getEvents(jobId);
    expect(events.map((e) => e.event_type)).toContain(JobEventType.Cancelled);
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

  it('sets started_at when job is picked up for processing', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'ts1@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.started_at).not.toBeNull();
  });

  it('sets completed_at when job is completed', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'ts2@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.completeJob(pool, jobId);
    const job = await getJobRow(jobId);
    expect(job.completed_at).not.toBeNull();
  });

  it('sets last_failed_at when job fails', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'ts3@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.failJob(pool, jobId, new Error('fail for ts'));
    const job = await getJobRow(jobId);
    expect(job.last_failed_at).not.toBeNull();
  });

  it('sets last_retried_at when job is retried', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'ts4@example.com' },
    });
    await queue.getNextBatch(pool, 'worker-ts', 1);
    await queue.failJob(pool, jobId, new Error('fail for ts retry'));
    // Make the job eligible for retry immediately
    await pool.query(
      'UPDATE job_queue SET next_attempt_at = NOW() WHERE id = $1',
      [jobId],
    );
    // Pick up for processing again (should increment attempts and set last_retried_at)
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.last_retried_at).not.toBeNull();
  });

  it('sets last_cancelled_at when job is cancelled', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
      payload: { to: 'ts5@example.com' },
    });
    await queue.cancelJob(pool, jobId);
    const job = await getJobRow(jobId);
    expect(job.last_cancelled_at).not.toBeNull();
  });

  it('sets last_retried_at when job is picked up for processing again (attempts > 0)', async () => {
    const jobId = await queue.addJob<{ email: { to: string } }, 'email'>(pool, {
      job_type: 'email',
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
    // Pick up for processing again (should increment attempts and set last_retried_at)
    await queue.getNextBatch(pool, 'worker-ts', 1);
    const job = await getJobRow(jobId);
    expect(job.last_retried_at).not.toBeNull();
  });
});
