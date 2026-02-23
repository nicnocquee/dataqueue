---
name: dataqueue-advanced
description: Advanced DataQueue patterns — step memoization, waits, tokens, cron, timeouts, tags, idempotency.
---

# DataQueue Advanced Patterns

## Step Memoization with ctx.run()

Wrap side-effectful work in `ctx.run(stepName, fn)`. Results are cached in the database — when the handler re-runs after a wait, completed steps replay from cache without re-executing.

```typescript
const handler = async (payload, signal, ctx) => {
  const data = await ctx.run('fetch-data', async () => {
    return await fetchFromAPI(payload.url);
  });

  await ctx.run('send-notification', async () => {
    await notify(data.userId, data.message);
  });
};
```

**Rules:**

- Step names must be unique within a handler.
- Step names must be stable across deployments while jobs are waiting.
- Step order must not change conditionally between re-invocations.

## Time-Based Waits

### waitFor (duration)

```typescript
const handler = async (payload, signal, ctx) => {
  await ctx.run('step-1', async () => {
    /* ... */
  });
  await ctx.waitFor({ hours: 24 });
  await ctx.run('step-2', async () => {
    /* ... */
  });
};
```

Duration fields: `seconds`, `minutes`, `hours`, `days`, `weeks`, `months`, `years` (additive).

### waitUntil (date)

```typescript
await ctx.waitUntil(new Date('2025-03-01T09:00:00Z'));
```

### How waits work internally

1. Handler throws a `WaitSignal` internally.
2. Job moves to `'waiting'` status — worker lock is released.
3. After the wait expires, job becomes `'pending'` again.
4. Handler re-runs from top; `ctx.run()` replays cached steps.

Waiting jobs are idle — they hold no lock, no concurrency slot, no resources.

## Token-Based Waits (Human-in-the-Loop)

Create a token, send it to an external actor, and wait for them to complete it.

```typescript
const handler = async (payload, signal, ctx) => {
  const token = await ctx.run('create-token', async () => {
    return await ctx.createToken({ timeout: '48h', tags: ['approval'] });
  });

  await ctx.run('notify', async () => {
    await sendSlack(`Approve: ${token.id}`);
  });

  const result = await ctx.waitForToken<{ approved: boolean }>(token.id);
  if (result.ok) {
    await ctx.run('process', async () => {
      if (result.output.approved) await approve(payload.id);
    });
  }
};
```

Complete tokens externally:

```typescript
await queue.completeToken(tokenId, { approved: true });
```

Expire timed-out tokens periodically:

```typescript
await queue.expireTimedOutTokens();
```

## Cron Scheduling

```typescript
const cronId = await queue.addCronJob({
  scheduleName: 'daily-report',
  cronExpression: '0 9 * * *',
  jobType: 'generate_report',
  payload: { reportId: 'daily', userId: 'system' },
  timezone: 'America/New_York',
  allowOverlap: false,
});
```

The processor automatically enqueues due cron jobs before each batch — no manual triggering needed.

Manage schedules:

```typescript
await queue.pauseCronJob(cronId);
await queue.resumeCronJob(cronId);
await queue.editCronJob(cronId, { cronExpression: '0 */2 * * *' });
await queue.removeCronJob(cronId);
const schedules = await queue.listCronJobs('active');
```

## Timeout Management

### Proactive — ctx.prolong()

```typescript
const handler = async (payload, signal, ctx) => {
  ctx.prolong(60_000); // set deadline to 60s from now
  await doHeavyWork();
  ctx.prolong(); // reset to original timeoutMs
};
```

### Reactive — ctx.onTimeout()

```typescript
const handler = async (payload, signal, ctx) => {
  let step = 0;
  ctx.onTimeout(() => {
    if (step < 3) return 30_000; // extend 30s
  });
  step = 1;
  await doStep1();
  step = 2;
  await doStep2();
  step = 3;
  await doStep3();
};
```

Both update `locked_at` in the DB, preventing premature reclamation.

### Force Kill on Timeout

```typescript
await queue.addJob({
  jobType: 'task',
  payload: {
    /* ... */
  },
  timeoutMs: 5000,
  forceKillOnTimeout: true,
});
```

**Limitations of forceKillOnTimeout:**

- Requires Node.js (not Bun).
- Handler must be serializable (no closures over external variables).
- `prolong`, `onTimeout`, `ctx.run`, waits are NOT available.

## Tags

```typescript
await queue.addJob({
  jobType: 'email',
  payload: {
    /* ... */
  },
  tags: ['welcome', 'onboarding'],
});

const jobs = await queue.getJobsByTags(['welcome'], 'any');
await queue.cancelAllUpcomingJobs({
  tags: { values: ['onboarding'], mode: 'all' },
});
```

Tag query modes: `'exact'`, `'all'`, `'any'`, `'none'`.

## Idempotency

```typescript
const jobId = await queue.addJob({
  jobType: 'email',
  payload: { to: 'user@example.com', subject: 'Welcome', body: '...' },
  idempotencyKey: `welcome-${userId}`,
});
```

If a job with the same key exists, returns the existing job ID. Key is unique across all statuses until `cleanupOldJobs` removes it.

## Transactional Job Creation (PostgreSQL Only)

Insert a job within an existing database transaction so the job is enqueued **atomically** with other writes:

```typescript
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function registerUser(email: string, name: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('INSERT INTO users (email, name) VALUES ($1, $2)', [
      email,
      name,
    ]);

    const queue = getJobQueue();
    await queue.addJob(
      {
        jobType: 'send_email',
        payload: { to: email, subject: 'Welcome!', body: `Hi ${name}!` },
      },
      { db: client },
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

The `db` option accepts any object matching `DatabaseClient { query(text, values): Promise<{ rows, rowCount }> }` — works with `pg.PoolClient`, `pg.Client`, or compatible ORM query runners.

The job event (`'added'`) is also inserted within the same transaction.

## Maintenance

Use `createSupervisor()` to automate all maintenance tasks in a long-running server:

```typescript
const supervisor = queue.createSupervisor({
  intervalMs: 60_000,
  stuckJobsTimeoutMinutes: 10,
  cleanupJobsDaysToKeep: 30,
  cleanupEventsDaysToKeep: 30,
});
supervisor.startInBackground();
```

For serverless or one-off scripts, call `supervisor.start()` (runs once) or use the manual methods:

```typescript
await queue.reclaimStuckJobs(10); // reclaim jobs stuck > 10 min
await queue.cleanupOldJobs(30); // delete completed jobs > 30 days
await queue.cleanupOldJobEvents(30); // delete old events > 30 days
await queue.expireTimedOutTokens(); // expire overdue tokens
```
