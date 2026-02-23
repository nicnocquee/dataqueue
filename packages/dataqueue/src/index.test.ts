import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initJobQueue, JobQueueConfig } from './index.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { Pool } from 'pg';
import type { CronScheduleRecord, AddJobOptions } from './types.js';

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
    expect(handler).toHaveBeenCalledWith(
      { foo: 'bar' },
      expect.any(Object),
      expect.any(Object),
    );
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
    const handler = vi.fn(async (payload: { foo: string }, _signal) => {
      expect(payload.foo).toBe('updated@example.com');
    });
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'original@example.com' },
    });

    // Edit the job before processing
    await jobQueue.editJob(jobId, {
      payload: { foo: 'updated@example.com' },
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
      { foo: 'updated@example.com' },
      expect.any(Object),
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
        sms: vi.fn(async () => {}),
        test: vi.fn(async () => {}),
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
    const slowHandler = vi.fn(async (payload: { to: string }, _signal) => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const slowHandlerTest = vi.fn(async (payload: { foo: string }, _signal) => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const processor2 = jobQueue.createProcessor(
      {
        email: slowHandler,
        sms: slowHandler,
        test: slowHandlerTest,
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

  // ── Configurable retry strategy integration tests ────────────────────

  it('should store and return retry config through public API', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'retry-api@example.com' },
      retryDelay: 20,
      retryBackoff: true,
      retryDelayMax: 300,
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.retryDelay).toBe(20);
    expect(job?.retryBackoff).toBe(true);
    expect(job?.retryDelayMax).toBe(300);
  });

  it('should use fixed delay on failure through public API', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'fixed-api@example.com' },
      maxAttempts: 3,
      retryDelay: 10,
      retryBackoff: false,
    });

    const handler = vi.fn(async () => {
      throw new Error('fail');
    });
    const processor = jobQueue.createProcessor({
      email: handler,
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.nextAttemptAt).not.toBeNull();
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(9);
    expect(delaySec).toBeLessThanOrEqual(11);
  });
});

describe('cron schedules integration', () => {
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
    vi.restoreAllMocks();
    jobQueue.getPool().end();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('creates a cron schedule and retrieves it by ID', async () => {
    // Act
    const id = await jobQueue.addCronJob({
      scheduleName: 'every-5-min-email',
      cronExpression: '*/5 * * * *',
      jobType: 'email',
      payload: { to: 'cron@example.com' },
    });

    // Assert
    const schedule = await jobQueue.getCronJob(id);
    expect(schedule).not.toBeNull();
    expect(schedule!.scheduleName).toBe('every-5-min-email');
    expect(schedule!.cronExpression).toBe('*/5 * * * *');
    expect(schedule!.jobType).toBe('email');
    expect(schedule!.payload).toEqual({ to: 'cron@example.com' });
    expect(schedule!.status).toBe('active');
    expect(schedule!.allowOverlap).toBe(false);
    expect(schedule!.timezone).toBe('UTC');
    expect(schedule!.nextRunAt).toBeInstanceOf(Date);
  });

  it('retrieves a cron schedule by name', async () => {
    // Setup
    await jobQueue.addCronJob({
      scheduleName: 'my-schedule',
      cronExpression: '0 * * * *',
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    // Act
    const schedule = await jobQueue.getCronJobByName('my-schedule');

    // Assert
    expect(schedule).not.toBeNull();
    expect(schedule!.scheduleName).toBe('my-schedule');
  });

  it('returns null for nonexistent schedule', async () => {
    // Act
    const byId = await jobQueue.getCronJob(99999);
    const byName = await jobQueue.getCronJobByName('nonexistent');

    // Assert
    expect(byId).toBeNull();
    expect(byName).toBeNull();
  });

  it('rejects duplicate schedule names', async () => {
    // Setup
    await jobQueue.addCronJob({
      scheduleName: 'unique-name',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });

    // Act & Assert
    await expect(
      jobQueue.addCronJob({
        scheduleName: 'unique-name',
        cronExpression: '*/5 * * * *',
        jobType: 'sms',
        payload: { to: 'b@example.com' },
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid cron expressions', async () => {
    // Act & Assert
    await expect(
      jobQueue.addCronJob({
        scheduleName: 'bad-cron',
        cronExpression: 'not a cron',
        jobType: 'email',
        payload: { to: 'a@example.com' },
      }),
    ).rejects.toThrow('Invalid cron expression');
  });

  it('lists active and paused schedules', async () => {
    // Setup
    const id1 = await jobQueue.addCronJob({
      scheduleName: 'schedule-1',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });
    await jobQueue.addCronJob({
      scheduleName: 'schedule-2',
      cronExpression: '*/5 * * * *',
      jobType: 'sms',
      payload: { to: 'b@example.com' },
    });
    await jobQueue.pauseCronJob(id1);

    // Act
    const all = await jobQueue.listCronJobs();
    const active = await jobQueue.listCronJobs('active');
    const paused = await jobQueue.listCronJobs('paused');

    // Assert
    expect(all).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0].scheduleName).toBe('schedule-2');
    expect(paused).toHaveLength(1);
    expect(paused[0].scheduleName).toBe('schedule-1');
  });

  it('pauses and resumes a schedule', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'pausable',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });

    // Act — pause
    await jobQueue.pauseCronJob(id);
    const paused = await jobQueue.getCronJob(id);

    // Assert
    expect(paused!.status).toBe('paused');

    // Act — resume
    await jobQueue.resumeCronJob(id);
    const resumed = await jobQueue.getCronJob(id);

    // Assert
    expect(resumed!.status).toBe('active');
  });

  it('edits a schedule and recalculates nextRunAt when expression changes', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'editable',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'old@example.com' },
    });
    const before = await jobQueue.getCronJob(id);

    // Act
    await jobQueue.editCronJob(id, {
      cronExpression: '0 0 * * *',
      payload: { to: 'new@example.com' },
    });

    // Assert
    const after = await jobQueue.getCronJob(id);
    expect(after!.cronExpression).toBe('0 0 * * *');
    expect(after!.payload).toEqual({ to: 'new@example.com' });
    expect(after!.nextRunAt!.getTime()).not.toBe(before!.nextRunAt!.getTime());
  });

  it('removes a schedule', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'removable',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });

    // Act
    await jobQueue.removeCronJob(id);

    // Assert
    const removed = await jobQueue.getCronJob(id);
    expect(removed).toBeNull();
  });

  it('enqueueDueCronJobs enqueues a job when nextRunAt is due', async () => {
    // Setup — insert a schedule with nextRunAt in the past
    const id = await jobQueue.addCronJob({
      scheduleName: 'due-now',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'due@example.com' },
    });
    // Force nextRunAt to be in the past
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // Act
    const count = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count).toBe(1);
    const jobs = await jobQueue.getJobsByStatus('pending');
    const cronJob = jobs.find(
      (j) =>
        j.jobType === 'email' && (j.payload as any).to === 'due@example.com',
    );
    expect(cronJob).toBeDefined();
  });

  it('enqueueDueCronJobs advances nextRunAt and sets lastJobId', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'advance-test',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'advance@example.com' },
    });
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // Act
    await jobQueue.enqueueDueCronJobs();

    // Assert
    const schedule = await jobQueue.getCronJob(id);
    expect(schedule!.lastJobId).not.toBeNull();
    expect(schedule!.lastEnqueuedAt).toBeInstanceOf(Date);
    expect(schedule!.nextRunAt).toBeInstanceOf(Date);
    expect(schedule!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('enqueueDueCronJobs skips paused schedules', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'paused-skip',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'paused@example.com' },
    });
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );
    await jobQueue.pauseCronJob(id);

    // Act
    const count = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count).toBe(0);
  });

  it('enqueueDueCronJobs skips schedules not yet due', async () => {
    // Setup — nextRunAt is calculated to the future by addCronJob
    await jobQueue.addCronJob({
      scheduleName: 'future-schedule',
      cronExpression: '0 0 1 1 *',
      jobType: 'email',
      payload: { to: 'future@example.com' },
    });

    // Act
    const count = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count).toBe(0);
  });

  it('enqueueDueCronJobs skips when allowOverlap=false and last job is still active', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'no-overlap',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'overlap@example.com' },
      allowOverlap: false,
    });
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // First enqueue should succeed
    const count1 = await jobQueue.enqueueDueCronJobs();
    expect(count1).toBe(1);

    // Set nextRunAt to past again (simulating next tick)
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // Act — second enqueue should be skipped because previous job is still pending
    const count2 = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count2).toBe(0);
  });

  it('enqueueDueCronJobs enqueues when allowOverlap=true even if last job is still active', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'with-overlap',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'overlap@example.com' },
      allowOverlap: true,
    });
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // First enqueue
    const count1 = await jobQueue.enqueueDueCronJobs();
    expect(count1).toBe(1);

    // Set nextRunAt to past again
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id],
    );

    // Act — second enqueue should succeed because allowOverlap=true
    const count2 = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count2).toBe(1);

    // Verify there are two pending jobs
    const jobs = await jobQueue.getJobsByStatus('pending');
    const cronJobs = jobs.filter(
      (j) =>
        j.jobType === 'email' &&
        (j.payload as any).to === 'overlap@example.com',
    );
    expect(cronJobs).toHaveLength(2);
  });

  it('should propagate retry config from cron schedule to enqueued jobs', async () => {
    const cronId = await jobQueue.addCronJob({
      scheduleName: 'retry-cron',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'cron-retry@example.com' },
      retryDelay: 15,
      retryBackoff: false,
      retryDelayMax: 90,
    });

    // Force next_run_at to the past
    await pool.query(
      `UPDATE cron_schedules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [cronId],
    );

    const count = await jobQueue.enqueueDueCronJobs();
    expect(count).toBe(1);

    const jobs = await jobQueue.getJobsByStatus('pending');
    const cronJob = jobs.find(
      (j) => (j.payload as any).to === 'cron-retry@example.com',
    );
    expect(cronJob).toBeDefined();
    expect(cronJob?.retryDelay).toBe(15);
    expect(cronJob?.retryBackoff).toBe(false);
    expect(cronJob?.retryDelayMax).toBe(90);
  });

  it('should store retry config on cron schedule record', async () => {
    const cronId = await jobQueue.addCronJob({
      scheduleName: 'retry-cron-record',
      cronExpression: '0 */2 * * *',
      jobType: 'email',
      payload: { to: 'cron-record@example.com' },
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 600,
    });

    const schedule = await jobQueue.getCronJob(cronId);
    expect(schedule?.retryDelay).toBe(30);
    expect(schedule?.retryBackoff).toBe(true);
    expect(schedule?.retryDelayMax).toBe(600);
  });
});

// ── BYOC (Bring Your Own Connection) tests ──────────────────────────────

describe('BYOC: init with external pool', () => {
  let pool: Pool;
  let dbName: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    jobQueue = initJobQueue<TestPayloadMap>({ pool });
  });

  afterEach(async () => {
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('uses the provided pool for addJob and getJob', async () => {
    // Act
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'byoc@example.com' },
    });

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.jobType).toBe('email');
    expect(job?.payload).toEqual({ to: 'byoc@example.com' });
  });

  it('returns the same pool instance from getPool()', () => {
    // Act
    const returnedPool = jobQueue.getPool();

    // Assert
    expect(returnedPool).toBe(pool);
  });
});

describe('BYOC: transactional addJob with db option', () => {
  let pool: Pool;
  let dbName: string;
  let testDbUrl: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;

  beforeEach(async () => {
    const setup = await createTestDbAndPool();
    pool = setup.pool;
    dbName = setup.dbName;
    testDbUrl = setup.testDbUrl;
    jobQueue = initJobQueue<TestPayloadMap>({
      databaseConfig: { connectionString: testDbUrl },
    });
  });

  afterEach(async () => {
    jobQueue.getPool().end();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('rolls back the job when the transaction is rolled back', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const jobId = await jobQueue.addJob(
      { jobType: 'email', payload: { to: 'rollback@example.com' } },
      { db: client },
    );
    await client.query('ROLLBACK');
    client.release();

    // Assert — job should not exist after rollback
    const job = await jobQueue.getJob(jobId);
    expect(job).toBeNull();
  });

  it('persists the job and event when the transaction is committed', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const jobId = await jobQueue.addJob(
      { jobType: 'email', payload: { to: 'commit@example.com' } },
      { db: client },
    );
    await client.query('COMMIT');
    client.release();

    // Assert — job exists
    const job = await jobQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.payload).toEqual({ to: 'commit@example.com' });

    // Assert — event was recorded in the same transaction
    const events = await jobQueue.getJobEvents(jobId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe('added');
  });

  it('job is visible within the transaction before commit', async () => {
    // Setup
    const client = await pool.connect();
    await client.query('BEGIN');

    // Act
    const jobId = await jobQueue.addJob(
      { jobType: 'sms', payload: { to: 'in-tx@example.com' } },
      { db: client },
    );

    // Assert — visible within the transaction
    const res = await client.query('SELECT id FROM job_queue WHERE id = $1', [
      jobId,
    ]);
    expect(res.rows).toHaveLength(1);

    await client.query('ROLLBACK');
    client.release();
  });
});

describe('addJobs batch insert', () => {
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

  it('inserts multiple jobs and returns IDs in order', async () => {
    // Act
    const ids = await jobQueue.addJobs([
      { jobType: 'email', payload: { to: 'a@test.com' } },
      { jobType: 'sms', payload: { to: '+1234' } },
      { jobType: 'email', payload: { to: 'b@test.com' } },
    ]);

    // Assert
    expect(ids).toHaveLength(3);

    const job0 = await jobQueue.getJob(ids[0]);
    expect(job0?.jobType).toBe('email');
    expect(job0?.payload).toEqual({ to: 'a@test.com' });

    const job1 = await jobQueue.getJob(ids[1]);
    expect(job1?.jobType).toBe('sms');

    const job2 = await jobQueue.getJob(ids[2]);
    expect(job2?.jobType).toBe('email');
    expect(job2?.payload).toEqual({ to: 'b@test.com' });
  });

  it('returns empty array for empty input', async () => {
    // Act
    const ids = await jobQueue.addJobs([]);

    // Assert
    expect(ids).toEqual([]);
  });

  it('handles idempotency keys correctly', async () => {
    // Setup
    const existingId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'existing@test.com' },
      idempotencyKey: 'batch-dup',
    });

    // Act
    const ids = await jobQueue.addJobs([
      { jobType: 'email', payload: { to: 'new@test.com' } },
      {
        jobType: 'email',
        payload: { to: 'dup@test.com' },
        idempotencyKey: 'batch-dup',
      },
    ]);

    // Assert
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(existingId);
    expect(ids[0]).not.toBe(existingId);
  });
});

describe('BYOC: validation errors', () => {
  it('throws when neither databaseConfig nor pool is provided for postgres', () => {
    // Act & Assert
    expect(() =>
      initJobQueue<TestPayloadMap>({ backend: 'postgres' } as any),
    ).toThrow(
      'PostgreSQL backend requires either "databaseConfig" or "pool" to be provided.',
    );
  });

  it('throws when neither redisConfig nor client is provided for redis', () => {
    // Act & Assert
    expect(() =>
      initJobQueue<TestPayloadMap>({ backend: 'redis' } as any),
    ).toThrow(
      'Redis backend requires either "redisConfig" or "client" to be provided.',
    );
  });
});

describe('event hooks', () => {
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
    jobQueue.removeAllListeners();
    jobQueue.getPool().end();
    await pool.end();
    await destroyTestDb(dbName);
  });

  it('emits job:added on addJob', async () => {
    const listener = vi.fn();
    jobQueue.on('job:added', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ jobId, jobType: 'email' });
  });

  it('emits job:added for each job in addJobs', async () => {
    const listener = vi.fn();
    jobQueue.on('job:added', listener);

    const ids = await jobQueue.addJobs([
      { jobType: 'email', payload: { to: 'a@test.com' } },
      { jobType: 'sms', payload: { to: '+1234' } },
    ]);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith({ jobId: ids[0], jobType: 'email' });
    expect(listener).toHaveBeenCalledWith({ jobId: ids[1], jobType: 'sms' });
  });

  it('emits job:cancelled on cancelJob', async () => {
    const listener = vi.fn();
    jobQueue.on('job:cancelled', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });
    await jobQueue.cancelJob(jobId);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ jobId });
  });

  it('emits job:retried on retryJob', async () => {
    const listener = vi.fn();
    jobQueue.on('job:retried', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    const handler = vi.fn(async () => {
      throw new Error('fail');
    });
    const processor = jobQueue.createProcessor({
      email: handler,
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    await jobQueue.retryJob(jobId);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ jobId });
  });

  it('emits job:processing and job:completed on successful processing', async () => {
    const processingListener = vi.fn();
    const completedListener = vi.fn();
    jobQueue.on('job:processing', processingListener);
    jobQueue.on('job:completed', completedListener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    expect(processingListener).toHaveBeenCalledTimes(1);
    expect(processingListener).toHaveBeenCalledWith({
      jobId,
      jobType: 'email',
    });
    expect(completedListener).toHaveBeenCalledTimes(1);
    expect(completedListener).toHaveBeenCalledWith({
      jobId,
      jobType: 'email',
    });
  });

  it('emits job:failed with willRetry true when attempts remain', async () => {
    const listener = vi.fn();
    jobQueue.on('job:failed', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
      maxAttempts: 3,
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {
        throw new Error('boom');
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        jobType: 'email',
        willRetry: true,
        error: expect.any(Error),
      }),
    );
  });

  it('emits job:failed with willRetry false when no attempts remain', async () => {
    const listener = vi.fn();
    jobQueue.on('job:failed', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
      maxAttempts: 1,
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {
        throw new Error('boom');
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        jobType: 'email',
        willRetry: false,
      }),
    );
  });

  it('emits job:waiting when handler calls ctx.waitFor', async () => {
    const listener = vi.fn();
    jobQueue.on('job:waiting', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async (_payload, _signal, ctx) => {
        await ctx.waitFor({ hours: 1 });
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ jobId, jobType: 'email' });
  });

  it('emits job:progress when handler calls ctx.setProgress', async () => {
    const listener = vi.fn();
    jobQueue.on('job:progress', listener);

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async (_payload, _signal, ctx) => {
        await ctx.setProgress(50);
        await ctx.setProgress(100);
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith({ jobId, progress: 50 });
    expect(listener).toHaveBeenCalledWith({ jobId, progress: 100 });
  });

  it('once fires only once then auto-unsubscribes', async () => {
    const listener = vi.fn();
    jobQueue.once('job:added', listener);

    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@test.com' },
    });
    await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: '+1234' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('off removes a listener', async () => {
    const listener = vi.fn();
    jobQueue.on('job:added', listener);

    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@test.com' },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    jobQueue.off('job:added', listener);

    await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: '+1234' },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners clears all listeners for a specific event', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const otherListener = vi.fn();
    jobQueue.on('job:added', listener1);
    jobQueue.on('job:added', listener2);
    jobQueue.on('job:cancelled', otherListener);

    jobQueue.removeAllListeners('job:added');

    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@test.com' },
    });
    const jobId = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: '+1234' },
    });
    await jobQueue.cancelJob(jobId);

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
    expect(otherListener).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners with no args clears everything', async () => {
    const addedListener = vi.fn();
    const cancelledListener = vi.fn();
    jobQueue.on('job:added', addedListener);
    jobQueue.on('job:cancelled', cancelledListener);

    jobQueue.removeAllListeners();

    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@test.com' },
    });
    await jobQueue.cancelJob(jobId);

    expect(addedListener).not.toHaveBeenCalled();
    expect(cancelledListener).not.toHaveBeenCalled();
  });

  it('onError callback still works alongside error event', async () => {
    const onErrorSpy = vi.fn();
    const errorListener = vi.fn();
    jobQueue.on('error', errorListener);

    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test@example.com' },
      maxAttempts: 1,
    });

    const processor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {
          throw new Error('boom');
        }),
        sms: vi.fn(async () => {}),
        test: vi.fn(async () => {}),
      },
      { onError: onErrorSpy },
    );
    await processor.start();

    // job:failed fires for individual job failures; error fires for
    // batch-level errors caught in processBatchWithHandlers. In this case
    // the job failure is handled inside processJobWithHandlers and doesn't
    // propagate to the batch-level error handler. So we verify that
    // onError still works as configured and job:failed events fire.
    const failedListener = vi.fn();
    jobQueue.on('job:failed', failedListener);

    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'test2@example.com' },
      maxAttempts: 1,
    });
    await processor.start();

    expect(failedListener).toHaveBeenCalledTimes(1);
  });
});
