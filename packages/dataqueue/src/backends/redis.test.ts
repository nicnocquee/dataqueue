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
});
