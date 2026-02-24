import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initJobQueue } from '../index.js';
import { createRedisTestPrefix, cleanupRedisPrefix } from '../test-util.js';
import type { RedisJobQueueConfig } from '../types.js';

interface TestPayloadMap {
  email: { to: string };
  sms: { to: string };
  test: { foo: string };
}

const REDIS_URL = process.env.REDIS_TEST_URL || 'redis://localhost:6379';

describe('Redis backend integration', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    const config: RedisJobQueueConfig = {
      backend: 'redis',
      redisConfig: {
        url: REDIS_URL,
        keyPrefix: prefix,
      },
    };
    jobQueue = initJobQueue<TestPayloadMap>(config);
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
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
    expect(job?.status).toBe('pending');
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

  it('should get all jobs', async () => {
    await jobQueue.addJob({ jobType: 'email', payload: { to: 'a@b.com' } });
    await jobQueue.addJob({ jobType: 'sms', payload: { to: 'c@d.com' } });
    const jobs = await jobQueue.getAllJobs();
    expect(jobs.length).toBe(2);
  });

  it('should process a job with a registered handler', async () => {
    const handler = vi.fn(async (_payload: any, _signal: any) => {});
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
    await processor.start();
    expect(handler).toHaveBeenCalledWith(
      { foo: 'bar' },
      expect.any(Object),
      expect.any(Object),
    );
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
  });

  it('should retry a failed job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'fail@example.com' },
    });
    // Use a handler that fails
    const processor = jobQueue.createProcessor(
      {
        email: async () => {
          throw new Error('boom');
        },
        sms: vi.fn(async () => {}),
        test: vi.fn(async () => {}),
      },
      { pollInterval: 100 },
    );
    await processor.start();
    let job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('failed');

    await jobQueue.retryJob(jobId);
    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
  });

  it('should route exhausted jobs to a dead-letter job type when configured', async () => {
    // Setup
    const sourceJobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'deadletter@example.com' },
      maxAttempts: 1,
      deadLetterJobType: 'email',
    });

    // Act
    const processor = jobQueue.createProcessor({
      email: async () => {
        throw new Error('permanent redis failure');
      },
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    // Assert
    const sourceJob = await jobQueue.getJob(sourceJobId);
    expect(sourceJob?.status).toBe('failed');
    expect(sourceJob?.nextAttemptAt).toBeNull();
    expect(sourceJob?.deadLetterJobType).toBe('email');
    expect(sourceJob?.deadLetteredAt).not.toBeNull();
    expect(sourceJob?.deadLetterJobId).not.toBeNull();

    const deadLetterJob = await jobQueue.getJob(sourceJob!.deadLetterJobId!);
    expect(deadLetterJob).not.toBeNull();
    expect(deadLetterJob?.status).toBe('pending');
    expect(deadLetterJob?.maxAttempts).toBe(1);

    const envelope = deadLetterJob?.payload as any;
    expect(envelope.originalJob.id).toBe(sourceJobId);
    expect(envelope.originalJob.jobType).toBe('email');
    expect(envelope.originalPayload).toEqual({ to: 'deadletter@example.com' });
    expect(envelope.failure.message).toBe('permanent redis failure');
    expect(envelope.failure.reason).toBe('handler_error');
  });

  it('should cancel a pending job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'cancelme@example.com' },
    });
    await jobQueue.cancelJob(jobId);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('cancelled');
  });

  it('should not cancel a non-pending job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'done' },
    });
    // Process it first
    const processor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
        sms: vi.fn(async () => {}),
        test: vi.fn(async () => {}),
      },
      { pollInterval: 100 },
    );
    await processor.start();
    const completedJob = await jobQueue.getJob(jobId);
    expect(completedJob?.status).toBe('completed');

    await jobQueue.cancelJob(jobId);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed'); // unchanged
  });

  it('should cancel all upcoming jobs', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
    });
    const cancelled = await jobQueue.cancelAllUpcomingJobs();
    expect(cancelled).toBe(2);
    const job1 = await jobQueue.getJob(jobId1);
    const job2 = await jobQueue.getJob(jobId2);
    expect(job1?.status).toBe('cancelled');
    expect(job2?.status).toBe('cancelled');
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
    const cancelled = await jobQueue.cancelAllUpcomingJobs({
      jobType: 'email',
    });
    expect(cancelled).toBe(1);
    expect((await jobQueue.getJob(jobId1))?.status).toBe('cancelled');
    expect((await jobQueue.getJob(jobId2))?.status).toBe('pending');
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
    const cancelled = await jobQueue.cancelAllUpcomingJobs({ priority: 2 });
    expect(cancelled).toBe(1);
    expect((await jobQueue.getJob(jobId1))?.status).toBe('pending');
    expect((await jobQueue.getJob(jobId2))?.status).toBe('cancelled');
  });

  it('should edit a pending job', async () => {
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
  });

  it('should edit all pending jobs', async () => {
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
      priority: 0,
    });
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
      priority: 0,
    });
    const smsId = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'c@example.com' },
      priority: 0,
    });

    const edited = await jobQueue.editAllPendingJobs(
      { jobType: 'email' },
      { priority: 5 },
    );
    expect(edited).toBe(2);
    const smsJob = await jobQueue.getJob(smsId);
    expect(smsJob?.priority).toBe(0); // unchanged
  });

  it('should record and retrieve job events', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'events@example.com' },
    });
    const events = await jobQueue.getJobEvents(jobId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe('added');
  });

  it('should record edited event', async () => {
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

  it('should support idempotency keys', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'idem@example.com' },
      idempotencyKey: 'unique-key-123',
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'idem@example.com' },
      idempotencyKey: 'unique-key-123',
    });
    expect(jobId1).toBe(jobId2);
  });

  it('should support tags and getJobsByTags', async () => {
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tagged1@example.com' },
      tags: ['foo', 'bar'],
    });
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tagged2@example.com' },
      tags: ['foo'],
    });
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tagged3@example.com' },
      tags: ['baz'],
    });

    // mode: 'all' - has both foo AND bar
    const allJobs = await jobQueue.getJobsByTags(['foo', 'bar'], 'all');
    expect(allJobs.length).toBe(1);
    expect(allJobs[0].payload).toEqual({ to: 'tagged1@example.com' });

    // mode: 'any' - has foo OR bar
    const anyJobs = await jobQueue.getJobsByTags(['foo', 'bar'], 'any');
    expect(anyJobs.length).toBe(2);

    // mode: 'exact' - exactly ['foo', 'bar']
    const exactJobs = await jobQueue.getJobsByTags(['foo', 'bar'], 'exact');
    expect(exactJobs.length).toBe(1);

    // mode: 'none' - neither foo nor bar
    const noneJobs = await jobQueue.getJobsByTags(['foo', 'bar'], 'none');
    expect(noneJobs.length).toBe(1);
    expect(noneJobs[0].payload).toEqual({ to: 'tagged3@example.com' });
  });

  it('should support priority ordering in processing', async () => {
    const processed: string[] = [];
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'low@example.com' },
      priority: 1,
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'high@example.com' },
      priority: 10,
    });
    const processor = jobQueue.createProcessor(
      {
        email: async (payload: any) => {
          processed.push(payload.to);
        },
        sms: vi.fn(async () => {}),
        test: vi.fn(async () => {}),
      },
      { batchSize: 10, concurrency: 1 },
    );
    await processor.start();
    // Higher priority should be first
    expect(processed[0]).toBe('high@example.com');
    expect(processed[1]).toBe('low@example.com');
  });

  it('should cleanup old completed jobs', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'cleanup' },
    });
    // Complete it
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();
    const completedJob = await jobQueue.getJob(jobId);
    expect(completedJob?.status).toBe('completed');

    // Manually set updatedAt to 31 days ago
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await redisClient.hset(
      `${prefix}job:${jobId}`,
      'updatedAt',
      oldMs.toString(),
    );

    const deleted = await jobQueue.cleanupOldJobs(30);
    expect(deleted).toBe(1);
    const job = await jobQueue.getJob(jobId);
    expect(job).toBeNull();
  });

  it('should cleanup old completed jobs in batches', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const jobId = await jobQueue.addJob({
        jobType: 'test',
        payload: { foo: `batch-${i}` },
      });
      ids.push(jobId);
    }
    // Complete all jobs
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();
    for (const id of ids) {
      const job = await jobQueue.getJob(id);
      expect(job?.status).toBe('completed');
    }

    // Backdate all to 31 days ago
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    for (const id of ids) {
      await redisClient.hset(
        `${prefix}job:${id}`,
        'updatedAt',
        oldMs.toString(),
      );
    }

    // Cleanup with small batchSize to force multiple SSCAN iterations
    const deleted = await jobQueue.cleanupOldJobs(30, 2);
    expect(deleted).toBe(5);
    for (const id of ids) {
      const job = await jobQueue.getJob(id);
      expect(job).toBeNull();
    }
  });

  it('should reclaim stuck jobs', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'stuck@example.com' },
    });
    // Manually set to processing with old lockedAt
    const oldMs = Date.now() - 15 * 60 * 1000; // 15 minutes ago
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'processing',
      'lockedAt',
      oldMs.toString(),
      'lockedBy',
      'dead-worker',
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:processing`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    const reclaimed = await jobQueue.reclaimStuckJobs(10);
    expect(reclaimed).toBe(1);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
    expect(job?.lockedAt).toBeNull();
  });

  it('should not reclaim a job whose timeoutMs exceeds the reclaim threshold', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'long-timeout@example.com' },
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    });
    // Simulate: processing for 15 minutes (exceeds 10-min global threshold but within 30-min job timeout)
    const oldMs = Date.now() - 15 * 60 * 1000;
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'processing',
      'lockedAt',
      oldMs.toString(),
      'lockedBy',
      'some-worker',
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:processing`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    const reclaimed = await jobQueue.reclaimStuckJobs(10);
    expect(reclaimed).toBe(0);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('processing');
  });

  it('should reclaim a job whose timeoutMs has also been exceeded', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'expired-timeout@example.com' },
      timeoutMs: 20 * 60 * 1000, // 20 minutes
    });
    // Simulate: processing for 25 minutes (exceeds both 10-min threshold and 20-min job timeout)
    const oldMs = Date.now() - 25 * 60 * 1000;
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'processing',
      'lockedAt',
      oldMs.toString(),
      'lockedBy',
      'some-worker',
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:processing`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    const reclaimed = await jobQueue.reclaimStuckJobs(10);
    expect(reclaimed).toBe(1);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
  });

  it('reclaims an in-flight job via supervisor and allows reprocessing', async () => {
    let firstAttempt = true;
    const handler = vi.fn(async () => {
      if (firstAttempt) {
        firstAttempt = false;
        await new Promise<void>(() => {});
      }
    });

    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'redis-reclaim-live-loop' },
    });

    const firstProcessor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
        sms: vi.fn(async () => {}),
        test: handler,
      },
      { pollInterval: 25, batchSize: 1, concurrency: 1 },
    );
    firstProcessor.startInBackground();

    let processingJob = await jobQueue.getJob(jobId);
    for (let i = 0; i < 50; i++) {
      if (processingJob?.status === 'processing') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      processingJob = await jobQueue.getJob(jobId);
    }
    expect(processingJob?.status).toBe('processing');

    await firstProcessor.stopAndDrain(25);

    const supervisor = jobQueue.createSupervisor({
      stuckJobsTimeoutMinutes: 0,
      cleanupJobsDaysToKeep: 0,
      cleanupEventsDaysToKeep: 0,
      expireTimedOutTokens: false,
    });
    const maintenance = await supervisor.start();
    expect(maintenance.reclaimedJobs).toBe(1);

    const reclaimedJob = await jobQueue.getJob(jobId);
    expect(reclaimedJob?.status).toBe('pending');
    expect(reclaimedJob?.lockedAt).toBeNull();
    expect(reclaimedJob?.lockedBy).toBeNull();

    const secondProcessor = jobQueue.createProcessor(
      {
        email: vi.fn(async () => {}),
        sms: vi.fn(async () => {}),
        test: handler,
      },
      { batchSize: 1, concurrency: 1 },
    );
    await secondProcessor.start();

    const completedJob = await jobQueue.getJob(jobId);
    expect(completedJob?.status).toBe('completed');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('getPool should throw for Redis backend', () => {
    expect(() => jobQueue.getPool()).toThrow(
      'getPool() is only available with the PostgreSQL backend',
    );
  });

  it('getRedisClient should return the Redis client', () => {
    const client = jobQueue.getRedisClient() as { get: unknown };
    expect(client).toBeDefined();
    expect(typeof client.get).toBe('function');
  });

  it('should get jobs with filters', async () => {
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
      priority: 1,
    });
    await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: 'b@example.com' },
      priority: 2,
    });
    await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'c@example.com' },
      priority: 3,
    });

    const emailJobs = await jobQueue.getJobs({ jobType: 'email' });
    expect(emailJobs.length).toBe(2);

    const priorityJobs = await jobQueue.getJobs({ priority: 2 });
    expect(priorityJobs.length).toBe(1);
    expect(priorityJobs[0].jobType).toBe('sms');
  });

  it('should cancel all upcoming jobs by tags', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tag1@example.com' },
      tags: ['foo', 'bar'],
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'tag2@example.com' },
      tags: ['baz'],
    });
    const cancelled = await jobQueue.cancelAllUpcomingJobs({
      tags: { values: ['foo'], mode: 'all' },
    });
    expect(cancelled).toBe(1);
    expect((await jobQueue.getJob(jobId1))?.status).toBe('cancelled');
    expect((await jobQueue.getJob(jobId2))?.status).toBe('pending');
  });

  it('should handle scheduled jobs (runAt in the future)', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour later
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'scheduled@example.com' },
      runAt: futureDate,
    });

    // Should not be picked up immediately
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    const processed = await processor.start();
    expect(processed).toBe(0);

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
  });

  // ── Configurable retry strategy tests ────────────────────────────────

  it('stores retry config on a job', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'retry-config@example.com' },
      retryDelay: 30,
      retryBackoff: false,
      retryDelayMax: 120,
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.retryDelay).toBe(30);
    expect(job?.retryBackoff).toBe(false);
    expect(job?.retryDelayMax).toBe(120);
  });

  it('returns null retry config for jobs without it', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'no-retry-config@example.com' },
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.retryDelay).toBeNull();
    expect(job?.retryBackoff).toBeNull();
    expect(job?.retryDelayMax).toBeNull();
  });

  it('uses legacy backoff when no retry config is set', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'legacy-retry@example.com' },
      maxAttempts: 3,
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
    const delayMs =
      job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime();
    // Legacy: 2^1 * 60s = 120s = 120000ms
    expect(delayMs).toBeGreaterThanOrEqual(115000);
    expect(delayMs).toBeLessThanOrEqual(125000);
  });

  it('uses fixed delay when retryBackoff is false', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'fixed-retry@example.com' },
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

  it('uses exponential backoff with custom retryDelay', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'expo-retry@example.com' },
      maxAttempts: 3,
      retryDelay: 5,
      retryBackoff: true,
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
    // 5 * 2^1 = 10s, with jitter [5, 10]
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(4);
    expect(delaySec).toBeLessThanOrEqual(11);
  });

  it('caps exponential backoff with retryDelayMax', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'capped-retry@example.com' },
      maxAttempts: 5,
      retryDelay: 100,
      retryBackoff: true,
      retryDelayMax: 30,
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
    // 100 * 2^1 = 200 capped to 30, with jitter [15, 30]
    const delaySec =
      (job!.nextAttemptAt!.getTime() - job!.lastFailedAt!.getTime()) / 1000;
    expect(delaySec).toBeGreaterThanOrEqual(14);
    expect(delaySec).toBeLessThanOrEqual(31);
  });

  it('allows editing retry config via editJob', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'edit-retry@example.com' },
    });

    await jobQueue.editJob(jobId, {
      retryDelay: 15,
      retryBackoff: false,
      retryDelayMax: 60,
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.retryDelay).toBe(15);
    expect(job?.retryBackoff).toBe(false);
    expect(job?.retryDelayMax).toBe(60);
  });
});

describe('Redis cron schedules integration', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    const config: RedisJobQueueConfig = {
      backend: 'redis',
      redisConfig: {
        url: REDIS_URL,
        keyPrefix: prefix,
      },
    };
    jobQueue = initJobQueue<TestPayloadMap>(config);
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
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

  it('stores deadLetterJobType on cron schedule and propagates it to enqueued jobs', async () => {
    // Setup
    const id = await jobQueue.addCronJob({
      scheduleName: 'cron-dead-letter-redis',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'redis-cron-dlq@example.com' },
      deadLetterJobType: 'email',
    });

    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());

    // Act
    const count = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count).toBe(1);
    const schedule = await jobQueue.getCronJob(id);
    expect(schedule?.deadLetterJobType).toBe('email');

    const jobs = await jobQueue.getJobsByStatus('pending');
    const cronJob = jobs.find(
      (j) =>
        j.jobType === 'email' &&
        (j.payload as any).to === 'redis-cron-dlq@example.com',
    );
    expect(cronJob).toBeDefined();
    expect(cronJob?.deadLetterJobType).toBe('email');
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
    // Setup — create schedule then force nextRunAt into the past
    const id = await jobQueue.addCronJob({
      scheduleName: 'due-now',
      cronExpression: '* * * * *',
      jobType: 'email',
      payload: { to: 'due@example.com' },
    });
    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());

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
    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());

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
    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());
    await jobQueue.pauseCronJob(id);

    // Act
    const count = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count).toBe(0);
  });

  it('enqueueDueCronJobs skips schedules not yet due', async () => {
    // Setup — nextRunAt is in the future by default
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
    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());

    // First enqueue should succeed
    const count1 = await jobQueue.enqueueDueCronJobs();
    expect(count1).toBe(1);

    // Force nextRunAt into the past again
    const pastMs2 = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs2);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs2), id.toString());

    // Act — second enqueue should be skipped because previous job is pending
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
    const pastMs = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs), id.toString());

    // First enqueue
    const count1 = await jobQueue.enqueueDueCronJobs();
    expect(count1).toBe(1);

    // Force nextRunAt into the past again
    const pastMs2 = (Date.now() - 60_000).toString();
    await redisClient.hset(`${prefix}cron:${id}`, 'nextRunAt', pastMs2);
    await redisClient.zadd(`${prefix}cron_due`, Number(pastMs2), id.toString());

    // Act — second enqueue should succeed because allowOverlap=true
    const count2 = await jobQueue.enqueueDueCronJobs();

    // Assert
    expect(count2).toBe(1);

    // Verify two pending jobs
    const jobs = await jobQueue.getJobsByStatus('pending');
    const cronJobs = jobs.filter(
      (j) =>
        j.jobType === 'email' &&
        (j.payload as any).to === 'overlap@example.com',
    );
    expect(cronJobs).toHaveLength(2);
  });
});

describe('Redis parity features', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    const config: RedisJobQueueConfig = {
      backend: 'redis',
      redisConfig: {
        url: REDIS_URL,
        keyPrefix: prefix,
      },
    };
    jobQueue = initJobQueue<TestPayloadMap>(config);
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
  });

  // ── Cursor-based pagination ─────────────────────────────────────────

  it('getJobs supports cursor-based pagination', async () => {
    // Setup
    const id1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'a@example.com' },
    });
    const id2 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'b@example.com' },
    });
    const id3 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'c@example.com' },
    });

    // Act — first page (no cursor, limit 2)
    const page1 = await jobQueue.getJobs({}, 2);

    // Assert
    expect(page1).toHaveLength(2);
    // Descending by id: id3, id2
    expect(page1[0].id).toBe(id3);
    expect(page1[1].id).toBe(id2);

    // Act — second page using cursor
    const page2 = await jobQueue.getJobs({ cursor: page1[1].id }, 2);

    // Assert
    expect(page2).toHaveLength(1);
    expect(page2[0].id).toBe(id1);
  });

  // ── retryJob status validation ──────────────────────────────────────

  it('retryJob only retries failed or processing jobs', async () => {
    // Setup — completed job
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'retry-test' },
    });
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();
    const completedJob = await jobQueue.getJob(jobId);
    expect(completedJob?.status).toBe('completed');

    // Act — retry a completed job (should be a no-op)
    await jobQueue.retryJob(jobId);

    // Assert — still completed
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
  });

  it('retryJob retries a failed job', async () => {
    // Setup
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'fail-retry@example.com' },
    });
    const processor = jobQueue.createProcessor({
      email: async () => {
        throw new Error('boom');
      },
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();
    const failedJob = await jobQueue.getJob(jobId);
    expect(failedJob?.status).toBe('failed');

    // Act
    await jobQueue.retryJob(jobId);

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
  });

  // ── cancelJob with waiting status ───────────────────────────────────

  it('cancelJob cancels a waiting job', async () => {
    // Setup — add a job and manually set it to waiting
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'waiting-cancel@example.com' },
    });
    const futureMs = Date.now() + 60_000;
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'waiting',
      'waitUntil',
      futureMs.toString(),
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:waiting`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    // Act
    await jobQueue.cancelJob(jobId);

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('cancelled');
    expect(job?.waitUntil).toBeNull();
    expect(job?.waitTokenId).toBeNull();
  });

  // ── completeJob clears wait fields ──────────────────────────────────

  it('completeJob clears wait-related fields', async () => {
    // Setup
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'wait-clear' },
    });
    // Manually set wait fields
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'stepData',
      JSON.stringify({ step1: { __completed: true, result: 42 } }),
      'waitUntil',
      (Date.now() + 60000).toString(),
      'waitTokenId',
      'wp_test',
    );

    // Process the job to completion
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.stepData).toBeUndefined();
    expect(job?.waitUntil).toBeNull();
    expect(job?.waitTokenId).toBeNull();
  });

  // ── Job output ─────────────────────────────────────────────────────

  it('stores output from ctx.setOutput() and retrieves via getJob', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'output@test.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async (_payload, _signal, ctx) => {
        await ctx.setOutput({ reportUrl: 'https://example.com/report.pdf' });
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toEqual({
      reportUrl: 'https://example.com/report.pdf',
    });
  });

  it('stores handler return value as output when setOutput is not called', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'return@test.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {
        return { processed: true, count: 42 };
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toEqual({ processed: true, count: 42 });
  });

  it('setOutput takes precedence over handler return value', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'precedence@test.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async (_payload, _signal, ctx) => {
        await ctx.setOutput({ fromSetOutput: true });
        return { fromReturn: true };
      }),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toEqual({ fromSetOutput: true });
  });

  it('output is null for jobs that do not set output (backward compat)', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'no-output@test.com' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.output).toBeNull();
  });

  it('stores scalar output values (string, number, array)', async () => {
    const jobId1 = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'string-output@test.com' },
    });
    const jobId2 = await jobQueue.addJob({
      jobType: 'sms',
      payload: { to: '+123' },
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => 'simple string'),
      sms: vi.fn(async () => 42),
      test: vi.fn(async () => {}),
    });
    await processor.start();

    const job1 = await jobQueue.getJob(jobId1);
    expect(job1?.output).toBe('simple string');

    const job2 = await jobQueue.getJob(jobId2);
    expect(job2?.output).toBe(42);
  });

  // ── cleanupOldJobEvents ─────────────────────────────────────────────

  it('cleanupOldJobEvents removes old events', async () => {
    // Setup
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'events-cleanup@example.com' },
    });

    // Create an old event (31 days ago)
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const oldEvent = JSON.stringify({
      id: 999,
      jobId,
      eventType: 'added',
      createdAt: oldMs,
      metadata: null,
    });
    await redisClient.rpush(`${prefix}events:${jobId}`, oldEvent);

    // Get events before cleanup
    const eventsBefore = await jobQueue.getJobEvents(jobId);
    const countBefore = eventsBefore.length;
    expect(countBefore).toBeGreaterThanOrEqual(2); // at least the original 'added' + our old event

    // Act
    const deleted = await jobQueue.cleanupOldJobEvents(30);

    // Assert
    expect(deleted).toBeGreaterThanOrEqual(1);
    const eventsAfter = await jobQueue.getJobEvents(jobId);
    expect(eventsAfter.length).toBeLessThan(countBefore);
  });

  it('cleanupOldJobEvents removes orphaned event lists', async () => {
    // Setup — create events for a non-existent job
    const orphanEvent = JSON.stringify({
      id: 888,
      jobId: 99999,
      eventType: 'added',
      createdAt: Date.now(),
      metadata: null,
    });
    await redisClient.rpush(`${prefix}events:99999`, orphanEvent);

    // Act
    const deleted = await jobQueue.cleanupOldJobEvents(30);

    // Assert
    expect(deleted).toBe(1);
    const remaining = await redisClient.llen(`${prefix}events:99999`);
    expect(remaining).toBe(0);
  });

  // ── Waiting system ──────────────────────────────────────────────────

  it('createToken and getToken work via the public API', async () => {
    // Act
    const token = await jobQueue.createToken({ timeout: '10m' });

    // Assert
    expect(token.id).toMatch(/^wp_/);
    const record = await jobQueue.getToken(token.id);
    expect(record).not.toBeNull();
    expect(record!.status).toBe('waiting');
    expect(record!.timeoutAt).toBeInstanceOf(Date);
  });

  it('completeToken completes the token and provides data', async () => {
    // Setup
    const token = await jobQueue.createToken();

    // Act
    await jobQueue.completeToken(token.id, { result: 'success' });

    // Assert
    const record = await jobQueue.getToken(token.id);
    expect(record!.status).toBe('completed');
    expect(record!.output).toEqual({ result: 'success' });
  });

  it('completeToken resumes a waiting job', async () => {
    // Setup — add a job, process it to create a token, then manually put it in waiting
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'token-resume@example.com' },
    });

    // Create a token associated with this job
    // We need to use the backend directly since createToken from public API uses null jobId
    const backend = jobQueue as any; // accessing the backend is tricky from the public API
    // Instead, create a token, then manually associate it
    const token = await jobQueue.createToken();

    // Manually update the token's jobId and put the job in waiting state
    await redisClient.hset(
      `${prefix}waitpoint:${token.id}`,
      'jobId',
      jobId.toString(),
    );
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'waiting',
      'waitTokenId',
      token.id,
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:waiting`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    // Act
    await jobQueue.completeToken(token.id, { data: 42 });

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
    expect(job?.waitTokenId).toBeNull();
  });

  it('expireTimedOutTokens expires tokens past their timeout', async () => {
    // Setup — create a token with a very short timeout, then backdate it
    const token = await jobQueue.createToken({ timeout: '1s' });
    // Force the timeout to be in the past
    const pastMs = Date.now() - 10_000;
    await redisClient.hset(
      `${prefix}waitpoint:${token.id}`,
      'timeoutAt',
      pastMs.toString(),
    );
    await redisClient.zadd(`${prefix}waitpoint_timeout`, pastMs, token.id);

    // Act
    const expired = await jobQueue.expireTimedOutTokens();

    // Assert
    expect(expired).toBe(1);
    const record = await jobQueue.getToken(token.id);
    expect(record!.status).toBe('timed_out');
  });

  it('expireTimedOutTokens resumes a waiting job when its token times out', async () => {
    // Setup
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'timeout-resume@example.com' },
    });
    const token = await jobQueue.createToken({ timeout: '1s' });

    // Associate token with job and put job in waiting
    await redisClient.hset(
      `${prefix}waitpoint:${token.id}`,
      'jobId',
      jobId.toString(),
    );
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'waiting',
      'waitTokenId',
      token.id,
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:waiting`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());

    // Force the timeout to be in the past
    const pastMs = Date.now() - 10_000;
    await redisClient.hset(
      `${prefix}waitpoint:${token.id}`,
      'timeoutAt',
      pastMs.toString(),
    );
    await redisClient.zadd(`${prefix}waitpoint_timeout`, pastMs, token.id);

    // Act
    await jobQueue.expireTimedOutTokens();

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');
    expect(job?.waitTokenId).toBeNull();
  });

  it('getNextBatch promotes time-based waiting jobs', async () => {
    // Setup — add a job and manually set it to waiting with a past waitUntil
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'wait-promote' },
    });
    const pastMs = Date.now() - 5000;
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'waiting',
      'waitUntil',
      pastMs.toString(),
      'waitTokenId',
      'null',
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:waiting`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());
    await redisClient.zadd(`${prefix}waiting`, pastMs, jobId.toString());

    // Act — process jobs, the waiting job should get promoted and processed
    const handler = vi.fn(async () => {});
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: handler,
    });
    const processed = await processor.start();

    // Assert
    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalled();
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
  });

  it('getNextBatch does NOT promote token-based waiting jobs', async () => {
    // Setup — add a job waiting for a token
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'token-wait-nopromote' },
    });
    const pastMs = Date.now() - 5000;
    await redisClient.hmset(
      `${prefix}job:${jobId}`,
      'status',
      'waiting',
      'waitUntil',
      pastMs.toString(),
      'waitTokenId',
      'wp_some_token',
    );
    await redisClient.srem(`${prefix}status:pending`, jobId.toString());
    await redisClient.sadd(`${prefix}status:waiting`, jobId.toString());
    await redisClient.zrem(`${prefix}queue`, jobId.toString());
    await redisClient.zadd(`${prefix}waiting`, pastMs, jobId.toString());

    // Act
    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: vi.fn(async () => {}),
    });
    const processed = await processor.start();

    // Assert — should not pick up the token-based waiting job
    expect(processed).toBe(0);
    const job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('waiting');
  });

  it('waitFor pauses a job and resumes after time elapses', async () => {
    // Setup
    let invocationCount = 0;
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'waitfor-test' },
    });

    // First invocation: handler calls ctx.waitFor
    const handler = vi.fn(async (_payload: any, _signal: any, ctx: any) => {
      invocationCount++;
      if (invocationCount === 1) {
        await ctx.waitFor({ seconds: 1 });
      }
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: handler,
    });
    await processor.start();

    // Assert — job should be in waiting state
    let job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('waiting');
    expect(job?.waitUntil).toBeInstanceOf(Date);
    expect(job?.stepData).toBeDefined();

    // Manually advance: set waitUntil to past and add to waiting sorted set
    const pastMs = Date.now() - 5000;
    await redisClient.hset(
      `${prefix}job:${jobId}`,
      'waitUntil',
      pastMs.toString(),
    );
    await redisClient.zadd(`${prefix}waiting`, pastMs, jobId.toString());

    // Second invocation: job resumes and completes
    await processor.start();

    // Assert
    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(invocationCount).toBe(2);
  });

  it('ctx.run memoizes step results across re-invocations', async () => {
    // Setup
    let invocationCount = 0;
    let stepCallCount = 0;
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'memoize-test' },
    });

    const handler = vi.fn(async (_payload: any, _signal: any, ctx: any) => {
      invocationCount++;
      const result = await ctx.run('step1', async () => {
        stepCallCount++;
        return 42;
      });
      expect(result).toBe(42);

      if (invocationCount === 1) {
        await ctx.waitFor({ seconds: 1 });
      }
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: handler,
    });

    // First invocation
    await processor.start();
    let job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('waiting');
    expect(stepCallCount).toBe(1);

    // Advance time
    const pastMs = Date.now() - 5000;
    await redisClient.hset(
      `${prefix}job:${jobId}`,
      'waitUntil',
      pastMs.toString(),
    );
    await redisClient.zadd(`${prefix}waiting`, pastMs, jobId.toString());

    // Second invocation
    await processor.start();

    // Assert — step1 should NOT have been called again (memoized)
    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(stepCallCount).toBe(1);
    expect(invocationCount).toBe(2);
  });

  it('waitForToken pauses and resumes on token completion', async () => {
    // Setup
    let invocationCount = 0;
    let tokenId: string;
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'token-wait-test' },
    });

    const handler = vi.fn(async (_payload: any, _signal: any, ctx: any) => {
      invocationCount++;
      if (invocationCount === 1) {
        const token = await ctx.createToken({ timeout: '1h' });
        tokenId = token.id;
        const result = await ctx.waitForToken(token.id);
        // Should not reach here on first invocation (throws WaitSignal)
        expect(result.ok).toBe(true);
      } else {
        // Second invocation: token should be completed
        // The step data should have the result cached
      }
    });

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {}),
      sms: vi.fn(async () => {}),
      test: handler,
    });

    // First invocation — should pause on waitForToken
    await processor.start();

    let job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('waiting');
    expect(job?.waitTokenId).toBe(tokenId!);

    // Complete the token externally
    await jobQueue.completeToken(tokenId!, { answer: 'yes' });

    // Verify job is back to pending
    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('pending');

    // Second invocation — should complete
    await processor.start();

    job = await jobQueue.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(invocationCount).toBe(2);
  });
});

// ── BYOC (Bring Your Own Connection) tests for Redis ────────────────────

describe('Redis BYOC: init with external client', () => {
  let prefix: string;
  let externalClient: any;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    const { default: IORedis } = await import('ioredis');
    externalClient = new (IORedis as any)(REDIS_URL);
    jobQueue = initJobQueue<TestPayloadMap>({
      backend: 'redis',
      client: externalClient,
      keyPrefix: prefix,
    });
  });

  afterEach(async () => {
    await cleanupRedisPrefix(externalClient, prefix);
    await externalClient.quit();
  });

  it('uses the provided client for addJob and getJob', async () => {
    // Act
    const jobId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'byoc-redis@example.com' },
    });

    // Assert
    const job = await jobQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.jobType).toBe('email');
    expect(job?.payload).toEqual({ to: 'byoc-redis@example.com' });
  });

  it('returns the same client instance from getRedisClient()', () => {
    // Act
    const returned = jobQueue.getRedisClient();

    // Assert
    expect(returned).toBe(externalClient);
  });
});

describe('Redis BYOC: addJob with db option throws', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    jobQueue = initJobQueue<TestPayloadMap>({
      backend: 'redis',
      redisConfig: { url: REDIS_URL, keyPrefix: prefix },
    });
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
  });

  it('throws a clear error when db option is provided', async () => {
    // Setup — fake db client
    const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) };

    // Act & Assert
    await expect(
      jobQueue.addJob(
        { jobType: 'email', payload: { to: 'fail@example.com' } },
        { db: fakeDb },
      ),
    ).rejects.toThrow('The db option is not supported with the Redis backend.');
  });
});

describe('Redis addJobs batch insert', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    jobQueue = initJobQueue<TestPayloadMap>({
      backend: 'redis',
      redisConfig: { url: REDIS_URL, keyPrefix: prefix },
    });
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
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
    expect(job1?.payload).toEqual({ to: '+1234' });

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

  it('handles idempotency keys for new jobs', async () => {
    // Act
    const ids = await jobQueue.addJobs([
      {
        jobType: 'email',
        payload: { to: 'a@test.com' },
        idempotencyKey: 'r-key-a',
      },
      {
        jobType: 'email',
        payload: { to: 'b@test.com' },
        idempotencyKey: 'r-key-b',
      },
    ]);

    // Assert
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    const job0 = await jobQueue.getJob(ids[0]);
    expect(job0?.idempotencyKey).toBe('r-key-a');
  });

  it('returns existing IDs for conflicting idempotency keys', async () => {
    // Setup
    const existingId = await jobQueue.addJob({
      jobType: 'email',
      payload: { to: 'existing@test.com' },
      idempotencyKey: 'r-dup',
    });

    // Act
    const ids = await jobQueue.addJobs([
      { jobType: 'email', payload: { to: 'new@test.com' } },
      {
        jobType: 'email',
        payload: { to: 'dup@test.com' },
        idempotencyKey: 'r-dup',
      },
    ]);

    // Assert
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(existingId);
    expect(ids[0]).not.toBe(existingId);
  });

  it('records added events for each inserted job', async () => {
    // Act
    const ids = await jobQueue.addJobs([
      { jobType: 'email', payload: { to: 'a@test.com' } },
      { jobType: 'sms', payload: { to: '+999' } },
    ]);

    // Assert
    const events0 = await jobQueue.getJobEvents(ids[0]);
    expect(events0.filter((e) => e.eventType === 'added')).toHaveLength(1);

    const events1 = await jobQueue.getJobEvents(ids[1]);
    expect(events1.filter((e) => e.eventType === 'added')).toHaveLength(1);
  });

  it('throws when db option is used with addJobs', async () => {
    // Setup
    const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) };

    // Act & Assert
    await expect(
      jobQueue.addJobs(
        [{ jobType: 'email', payload: { to: 'fail@test.com' } }],
        { db: fakeDb },
      ),
    ).rejects.toThrow('The db option is not supported with the Redis backend.');
  });

  it('stores tags and priority correctly per job', async () => {
    // Act
    const ids = await jobQueue.addJobs([
      {
        jobType: 'email',
        payload: { to: 'a@test.com' },
        tags: ['urgent'],
        priority: 10,
      },
      { jobType: 'sms', payload: { to: '+1' }, priority: 5 },
      { jobType: 'email', payload: { to: 'c@test.com' }, tags: ['low'] },
    ]);

    // Assert
    const job0 = await jobQueue.getJob(ids[0]);
    expect(job0?.tags).toEqual(['urgent']);
    expect(job0?.priority).toBe(10);

    const job1 = await jobQueue.getJob(ids[1]);
    expect(job1?.priority).toBe(5);

    const job2 = await jobQueue.getJob(ids[2]);
    expect(job2?.tags).toEqual(['low']);
  });
});

describe('Redis event hooks', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    jobQueue = initJobQueue<TestPayloadMap>({
      backend: 'redis',
      redisConfig: { url: REDIS_URL, keyPrefix: prefix },
    });
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    jobQueue.removeAllListeners();
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
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

    const processor = jobQueue.createProcessor({
      email: vi.fn(async () => {
        throw new Error('fail');
      }),
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

  it('emits job:failed with willRetry flag', async () => {
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
        error: expect.any(Error),
      }),
    );
  });

  it('once fires only once then auto-unsubscribes', async () => {
    const listener = vi.fn();
    jobQueue.once('job:added', listener);

    await jobQueue.addJob({ jobType: 'email', payload: { to: 'a@test.com' } });
    await jobQueue.addJob({ jobType: 'sms', payload: { to: '+1234' } });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('off removes a listener', async () => {
    const listener = vi.fn();
    jobQueue.on('job:added', listener);

    await jobQueue.addJob({ jobType: 'email', payload: { to: 'a@test.com' } });
    expect(listener).toHaveBeenCalledTimes(1);

    jobQueue.off('job:added', listener);

    await jobQueue.addJob({ jobType: 'sms', payload: { to: '+1234' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('Redis group-based concurrency limits', () => {
  let prefix: string;
  let jobQueue: ReturnType<typeof initJobQueue<TestPayloadMap>>;
  let redisClient: any;

  beforeEach(async () => {
    prefix = createRedisTestPrefix();
    const config: RedisJobQueueConfig = {
      backend: 'redis',
      redisConfig: {
        url: REDIS_URL,
        keyPrefix: prefix,
      },
    };
    jobQueue = initJobQueue<TestPayloadMap>(config);
    redisClient = jobQueue.getRedisClient();
  });

  afterEach(async () => {
    await cleanupRedisPrefix(redisClient, prefix);
    await redisClient.quit();
  });

  it('stores group metadata for Redis jobs', async () => {
    const jobId = await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'grouped' },
      group: { id: 'tenant-r1', tier: 'silver' },
    });

    const job = await jobQueue.getJob(jobId);
    expect(job?.groupId).toBe('tenant-r1');
    expect(job?.groupTier).toBe('silver');
  });

  it('enforces global grouped limits across processor instances', async () => {
    await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'job-1' },
      group: { id: 'tenant-r2' },
    });
    await jobQueue.addJob({
      jobType: 'test',
      payload: { foo: 'job-2' },
      group: { id: 'tenant-r2' },
    });

    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = vi.fn(async () => {
      started += 1;
      await gate;
    });

    const processorA = jobQueue.createProcessor(
      { email: vi.fn(), sms: vi.fn(), test: handler },
      { batchSize: 2, concurrency: 2, groupConcurrency: 1 },
    );
    const processorB = jobQueue.createProcessor(
      { email: vi.fn(), sms: vi.fn(), test: handler },
      { batchSize: 2, concurrency: 2, groupConcurrency: 1 },
    );

    const runA = processorA.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const processedByB = await processorB.start();

    expect(processedByB).toBe(0);
    expect(started).toBe(1);

    release();
    await runA;

    const pendingAfterA = await jobQueue.getJobsByStatus('pending');
    expect(pendingAfterA).toHaveLength(1);

    const processedByBSecondRun = await processorB.start();
    expect(processedByBSecondRun).toBe(1);
  });
});
