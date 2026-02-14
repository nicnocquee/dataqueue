import { Pool } from 'pg';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { processJobWithHandlers } from './processor.js';
import * as queue from './queue.js';
import { createTestDbAndPool, destroyTestDb } from './test-util.js';
import { JobHandler, JobContext, WaitSignal } from './types.js';

// Payload map for wait-related tests
interface WaitPayloadMap {
  stepJob: { value: string };
  waitJob: { step: number };
  tokenJob: { userId: string };
  multiWait: { data: string };
}

// Full handlers object (all job types must be present)
function makeHandlers(overrides: Partial<Record<keyof WaitPayloadMap, any>>) {
  return {
    stepJob: vi.fn(async () => {}),
    waitJob: vi.fn(async () => {}),
    tokenJob: vi.fn(async () => {}),
    multiWait: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ctx.run step tracking', () => {
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

  it('should execute steps and persist step data', async () => {
    const executionOrder: string[] = [];

    const handler: JobHandler<WaitPayloadMap, 'stepJob'> = async (
      payload,
      _signal,
      ctx,
    ) => {
      const result1 = await ctx.run('step1', async () => {
        executionOrder.push('step1');
        return 'result-1';
      });
      expect(result1).toBe('result-1');

      const result2 = await ctx.run('step2', async () => {
        executionOrder.push('step2');
        return 42;
      });
      expect(result2).toBe(42);
    };

    const handlers = makeHandlers({ stepJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'stepJob'>(pool, {
      jobType: 'stepJob',
      payload: { value: 'test' },
    });
    const job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    // Job should be completed
    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(executionOrder).toEqual(['step1', 'step2']);
  });

  it('should replay completed steps from cache on re-invocation', async () => {
    const executionOrder: string[] = [];
    let invocationCount = 0;

    const handler: JobHandler<WaitPayloadMap, 'stepJob'> = async (
      payload,
      _signal,
      ctx,
    ) => {
      invocationCount++;

      await ctx.run('step1', async () => {
        executionOrder.push('step1-executed');
        return 'done';
      });

      // On first invocation, this will throw WaitSignal
      // On second invocation, the wait is already completed
      await ctx.waitFor({ seconds: 1 });

      await ctx.run('step2', async () => {
        executionOrder.push('step2-executed');
        return 'done';
      });
    };

    const handlers = makeHandlers({ stepJob: handler });

    // First invocation: step1 executes, waitFor throws WaitSignal
    const jobId = await queue.addJob<WaitPayloadMap, 'stepJob'>(pool, {
      jobType: 'stepJob',
      payload: { value: 'test' },
    });
    let job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    // Job should be in 'waiting' status
    job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    expect(job?.status).toBe('waiting');
    expect(job?.waitUntil).toBeInstanceOf(Date);
    expect(executionOrder).toEqual(['step1-executed']);

    // Simulate wait elapsed by setting wait_until to the past
    const client = await pool.connect();
    await client.query(
      `UPDATE job_queue SET wait_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [jobId],
    );
    client.release();

    // Pick up the job again (simulating processor poll)
    const batch = await queue.getNextBatch<WaitPayloadMap, 'stepJob'>(
      pool,
      'worker-test',
      1,
    );
    expect(batch.length).toBe(1);

    // Second invocation: step1 replayed from cache, wait skipped, step2 executes
    await processJobWithHandlers(pool, batch[0]!, handlers);

    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(invocationCount).toBe(2);
    // step1 should only have executed once (replayed from cache on second run)
    expect(executionOrder).toEqual(['step1-executed', 'step2-executed']);
  });

  it('should not increment attempts when resuming from wait', async () => {
    const handler: JobHandler<WaitPayloadMap, 'stepJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.run('step1', async () => 'done');
      await ctx.waitFor({ seconds: 1 });
      await ctx.run('step2', async () => 'done');
    };

    const handlers = makeHandlers({ stepJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'stepJob'>(pool, {
      jobType: 'stepJob',
      payload: { value: 'test' },
      maxAttempts: 3,
    });

    // First invocation
    let job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    // Check attempts after first wait
    job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    expect(job?.status).toBe('waiting');

    // Simulate wait elapsed
    const client = await pool.connect();
    await client.query(
      `UPDATE job_queue SET wait_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [jobId],
    );
    client.release();

    // Pick up the job (should NOT increment attempts)
    const batch = await queue.getNextBatch<WaitPayloadMap, 'stepJob'>(
      pool,
      'worker-test',
      1,
    );
    expect(batch.length).toBe(1);

    // The attempts should still be 0 (waiting jobs don't increment)
    // Note: the first processJobWithHandlers was called directly (not via getNextBatch),
    // so attempts was never incremented. When resuming from wait via getNextBatch, it should stay the same.
    expect(batch[0]!.attempts).toBe(0);
  });
});

describe('ctx.waitFor / ctx.waitUntil', () => {
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

  it('should set job to waiting status with wait_until', async () => {
    const handler: JobHandler<WaitPayloadMap, 'waitJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.waitFor({ hours: 1 });
    };

    const handlers = makeHandlers({ waitJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'waitJob'>(pool, {
      jobType: 'waitJob',
      payload: { step: 0 },
    });
    const job = await queue.getJob<WaitPayloadMap, 'waitJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    const waiting = await queue.getJob(pool, jobId);
    expect(waiting?.status).toBe('waiting');
    expect(waiting?.waitUntil).toBeInstanceOf(Date);
    // wait_until should be approximately 1 hour from now
    const diff = waiting!.waitUntil!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(55 * 60 * 1000); // at least 55 minutes
    expect(diff).toBeLessThan(65 * 60 * 1000); // at most 65 minutes
  });

  it('should set job to waiting status with waitUntil date', async () => {
    const targetDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    const handler: JobHandler<WaitPayloadMap, 'waitJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.waitUntil(targetDate);
    };

    const handlers = makeHandlers({ waitJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'waitJob'>(pool, {
      jobType: 'waitJob',
      payload: { step: 0 },
    });
    const job = await queue.getJob<WaitPayloadMap, 'waitJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    const waiting = await queue.getJob(pool, jobId);
    expect(waiting?.status).toBe('waiting');
    const timeDiff = Math.abs(
      waiting!.waitUntil!.getTime() - targetDate.getTime(),
    );
    expect(timeDiff).toBeLessThan(1000); // within 1 second of target
  });

  it('should record a waiting event', async () => {
    const handler: JobHandler<WaitPayloadMap, 'waitJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.waitFor({ minutes: 30 });
    };

    const handlers = makeHandlers({ waitJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'waitJob'>(pool, {
      jobType: 'waitJob',
      payload: { step: 0 },
    });
    const job = await queue.getJob<WaitPayloadMap, 'waitJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    const events = await queue.getJobEvents(pool, jobId);
    const waitingEvents = events.filter((e) => e.eventType === 'waiting');
    expect(waitingEvents.length).toBe(1);
    expect(waitingEvents[0]!.metadata).toHaveProperty('waitUntil');
  });

  it('waiting jobs should not be picked up before wait_until', async () => {
    const handler: JobHandler<WaitPayloadMap, 'waitJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.waitFor({ hours: 1 });
    };

    const handlers = makeHandlers({ waitJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'waitJob'>(pool, {
      jobType: 'waitJob',
      payload: { step: 0 },
    });
    const job = await queue.getJob<WaitPayloadMap, 'waitJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    // Try to pick up -- should get nothing (wait_until is in the future)
    const batch = await queue.getNextBatch<WaitPayloadMap, 'waitJob'>(
      pool,
      'worker-test',
      1,
    );
    expect(batch.length).toBe(0);
  });

  it('should handle multiple sequential waits', async () => {
    let phase = 0;

    const handler: JobHandler<WaitPayloadMap, 'multiWait'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.run('phase1', async () => {
        phase = 1;
      });
      await ctx.waitFor({ seconds: 1 });

      await ctx.run('phase2', async () => {
        phase = 2;
      });
      await ctx.waitFor({ seconds: 1 });

      await ctx.run('phase3', async () => {
        phase = 3;
      });
    };

    const handlers = makeHandlers({ multiWait: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'multiWait'>(pool, {
      jobType: 'multiWait',
      payload: { data: 'test' },
    });

    // First invocation: phase1 runs, first waitFor triggers
    let job = await queue.getJob<WaitPayloadMap, 'multiWait'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);
    expect(phase).toBe(1);

    let waiting = await queue.getJob(pool, jobId);
    expect(waiting?.status).toBe('waiting');

    // Simulate wait elapsed
    const client = await pool.connect();
    await client.query(
      `UPDATE job_queue SET wait_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [jobId],
    );
    client.release();

    // Second invocation: phase1 cached, first wait skipped, phase2 runs, second waitFor triggers
    let batch = await queue.getNextBatch<WaitPayloadMap, 'multiWait'>(
      pool,
      'worker-test',
      1,
    );
    await processJobWithHandlers(pool, batch[0]!, handlers);
    expect(phase).toBe(2);

    waiting = await queue.getJob(pool, jobId);
    expect(waiting?.status).toBe('waiting');

    // Simulate second wait elapsed
    const client2 = await pool.connect();
    await client2.query(
      `UPDATE job_queue SET wait_until = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [jobId],
    );
    client2.release();

    // Third invocation: all previous steps cached, both waits skipped, phase3 runs
    batch = await queue.getNextBatch<WaitPayloadMap, 'multiWait'>(
      pool,
      'worker-test',
      1,
    );
    await processJobWithHandlers(pool, batch[0]!, handlers);
    expect(phase).toBe(3);

    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });
});

describe('ctx.waitForToken', () => {
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

  it('should pause job and resume when token is completed', async () => {
    let tokenId: string | undefined;
    let tokenResult: any;

    const handler: JobHandler<WaitPayloadMap, 'tokenJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      const token = await ctx.run('create-token', async () => {
        return await ctx.createToken({ timeout: '10m' });
      });
      tokenId = token.id;

      const result = await ctx.waitForToken<{ status: string }>(token.id);
      tokenResult = result;
    };

    const handlers = makeHandlers({ tokenJob: handler });

    // First invocation: creates token, then pauses
    const jobId = await queue.addJob<WaitPayloadMap, 'tokenJob'>(pool, {
      jobType: 'tokenJob',
      payload: { userId: 'user-123' },
    });
    let job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    expect(tokenId).toBeDefined();
    job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    expect(job?.status).toBe('waiting');
    expect(job?.waitTokenId).toBe(tokenId);

    // Verify the waitpoint exists
    const wp = await queue.getWaitpoint(pool, tokenId!);
    expect(wp).not.toBeNull();
    expect(wp?.status).toBe('waiting');

    // Complete the token externally
    await queue.completeWaitpoint(pool, tokenId!, {
      status: 'approved',
    });

    // Job should be back to 'pending'
    job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    expect(job?.status).toBe('pending');

    // Second invocation: step1 replayed, waitForToken returns the result
    const batch = await queue.getNextBatch<WaitPayloadMap, 'tokenJob'>(
      pool,
      'worker-test',
      1,
    );
    expect(batch.length).toBe(1);
    await processJobWithHandlers(pool, batch[0]!, handlers);

    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(tokenResult).toEqual({ ok: true, output: { status: 'approved' } });
  });

  it('should handle token timeout', async () => {
    let tokenId: string | undefined;
    let tokenResult: any;

    const handler: JobHandler<WaitPayloadMap, 'tokenJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      const token = await ctx.run('create-token', async () => {
        return await ctx.createToken({ timeout: '1s' });
      });
      tokenId = token.id;

      const result = await ctx.waitForToken<{ status: string }>(token.id);
      tokenResult = result;
    };

    const handlers = makeHandlers({ tokenJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'tokenJob'>(pool, {
      jobType: 'tokenJob',
      payload: { userId: 'user-456' },
    });
    let job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    expect(tokenId).toBeDefined();
    job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    expect(job?.status).toBe('waiting');

    // Simulate token timeout by setting timeout_at in the past
    const client = await pool.connect();
    await client.query(
      `UPDATE waitpoints SET timeout_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [tokenId],
    );
    client.release();

    // Expire timed-out tokens
    const expired = await queue.expireTimedOutWaitpoints(pool);
    expect(expired).toBe(1);

    // Job should be back to 'pending'
    job = await queue.getJob<WaitPayloadMap, 'tokenJob'>(pool, jobId);
    expect(job?.status).toBe('pending');

    // Verify waitpoint is timed_out
    const wp = await queue.getWaitpoint(pool, tokenId!);
    expect(wp?.status).toBe('timed_out');

    // Second invocation: waitForToken returns timeout result
    const batch = await queue.getNextBatch<WaitPayloadMap, 'tokenJob'>(
      pool,
      'worker-test',
      1,
    );
    expect(batch.length).toBe(1);
    await processJobWithHandlers(pool, batch[0]!, handlers);

    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
    expect(tokenResult).toEqual({ ok: false, error: 'Token timed out' });
  });
});

describe('cancel waiting job', () => {
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

  it('should cancel a job in waiting status', async () => {
    const handler: JobHandler<WaitPayloadMap, 'waitJob'> = async (
      _payload,
      _signal,
      ctx,
    ) => {
      await ctx.waitFor({ hours: 24 });
    };

    const handlers = makeHandlers({ waitJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'waitJob'>(pool, {
      jobType: 'waitJob',
      payload: { step: 0 },
    });
    const job = await queue.getJob<WaitPayloadMap, 'waitJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    // Verify waiting
    let waiting = await queue.getJob(pool, jobId);
    expect(waiting?.status).toBe('waiting');

    // Cancel the waiting job
    await queue.cancelJob(pool, jobId);

    const cancelled = await queue.getJob(pool, jobId);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.waitUntil).toBeNull();
    expect(cancelled?.waitTokenId).toBeNull();
  });
});

describe('createToken / completeToken outside handlers', () => {
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

  it('should create and retrieve a token', async () => {
    const token = await queue.createWaitpoint(pool, null, {
      timeout: '10m',
      tags: ['approval', 'user:123'],
    });

    expect(token.id).toMatch(/^wp_/);

    const retrieved = await queue.getWaitpoint(pool, token.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe('waiting');
    expect(retrieved?.timeoutAt).toBeInstanceOf(Date);
    expect(retrieved?.tags).toEqual(['approval', 'user:123']);
  });

  it('should complete a token and store output', async () => {
    const token = await queue.createWaitpoint(pool, null);
    await queue.completeWaitpoint(pool, token.id, { approved: true });

    const retrieved = await queue.getWaitpoint(pool, token.id);
    expect(retrieved?.status).toBe('completed');
    expect(retrieved?.output).toEqual({ approved: true });
    expect(retrieved?.completedAt).toBeInstanceOf(Date);
  });
});

describe('WaitSignal class', () => {
  it('should be an instance of Error', () => {
    const signal = new WaitSignal('duration', new Date(), undefined, {});
    expect(signal).toBeInstanceOf(Error);
    expect(signal).toBeInstanceOf(WaitSignal);
    expect(signal.isWaitSignal).toBe(true);
    expect(signal.name).toBe('WaitSignal');
  });
});

describe('existing handlers without wait features', () => {
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

  it('should still work without using ctx.run or wait methods', async () => {
    const handler: JobHandler<WaitPayloadMap, 'stepJob'> = async (
      payload,
      _signal,
      _ctx,
    ) => {
      // Traditional handler that ignores ctx.run and waits
      expect(payload.value).toBe('hello');
    };

    const handlers = makeHandlers({ stepJob: handler });
    const jobId = await queue.addJob<WaitPayloadMap, 'stepJob'>(pool, {
      jobType: 'stepJob',
      payload: { value: 'hello' },
    });
    const job = await queue.getJob<WaitPayloadMap, 'stepJob'>(pool, jobId);
    await processJobWithHandlers(pool, job!, handlers);

    const completed = await queue.getJob(pool, jobId);
    expect(completed?.status).toBe('completed');
  });
});
