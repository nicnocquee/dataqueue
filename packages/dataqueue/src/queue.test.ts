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
    await queue.completeJob(pool, jobId);
    const job = await queue.getJob(pool, jobId);
    expect(job?.status).toBe('completed');
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
    // Add a completed job
    const jobId4 = await queue.addJob<{ email: { to: string } }, 'email'>(
      pool,
      {
        jobType: 'email',
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
    // Fail the job twice with different errors
    await queue.failJob(pool, jobId, new Error('first error'));
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
});
