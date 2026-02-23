# DataQueue — Advanced Rules

## Step Memoization (ctx.run)

Wrap side-effectful work in `ctx.run(stepName, fn)` for durability. Cached results replay on re-invocation after a wait.

```typescript
const data = await ctx.run('fetch', async () => fetchFromAPI(url));
await ctx.waitFor({ hours: 1 });
await ctx.run('notify', async () => sendNotification(data));
```

Step names must be unique within a handler and stable across deployments.

## Waits

- `ctx.waitFor({ hours: 24 })` — pause for a duration (seconds, minutes, hours, days, weeks, months, years).
- `ctx.waitUntil(date)` — pause until a specific date.
- `ctx.waitForToken(tokenId)` — pause until an external actor completes the token.

Waiting jobs release their worker lock and concurrency slot. They consume no resources.

Wait calls use a positional counter internally. Do not add/remove waits conditionally between re-invocations.

## Token System

```typescript
const token = await ctx.createToken({ timeout: '48h', tags: ['approval'] });
const result = await ctx.waitForToken<{ approved: boolean }>(token.id);
if (result.ok) {
  /* result.output.approved */
}
```

Complete externally: `await queue.completeToken(tokenId, { approved: true })`.
Expire timed-out tokens: `await queue.expireTimedOutTokens()`.

## Cron Scheduling

```typescript
await queue.addCronJob({
  scheduleName: 'daily-cleanup',
  cronExpression: '0 2 * * *',
  jobType: 'cleanup',
  payload: { days: 30 },
  timezone: 'UTC',
  allowOverlap: false,
});
```

The processor auto-enqueues due cron jobs before each batch. Manage with `pauseCronJob`, `resumeCronJob`, `editCronJob`, `removeCronJob`, `listCronJobs`.

## Timeout Management

- `ctx.prolong(ms)` — proactively reset deadline. `ctx.prolong()` resets to original `timeoutMs`.
- `ctx.onTimeout(() => ms)` — reactive; return ms to extend, or nothing to let timeout proceed.
- `forceKillOnTimeout: true` — terminates handler via Worker Thread. Requires Node.js, serializable handler, and disables `ctx.run`/waits/`prolong`/`onTimeout`.

## Tags and Filtering

```typescript
await queue.addJob({ jobType: 'email', payload, tags: ['welcome', 'user'] });
const jobs = await queue.getJobsByTags(['welcome'], 'any');
await queue.cancelAllUpcomingJobs({ tags: { values: ['user'], mode: 'all' } });
```

Modes: `exact` (exact set), `all` (superset), `any` (intersection), `none` (exclusion).

## Idempotency

```typescript
await queue.addJob({
  jobType: 'email',
  payload,
  idempotencyKey: `welcome-${userId}`,
});
```

Returns existing job ID if key already exists. Key persists until `cleanupOldJobs` removes the job.

## Scaling

- Increase `batchSize` and `concurrency` for higher throughput.
- Run multiple processor instances with unique `workerId` values — `FOR UPDATE SKIP LOCKED` (PostgreSQL) or Lua scripts (Redis) prevent double-claiming.
- Use `jobType` filter for specialized workers.
- Call `cleanupOldJobs` and `reclaimStuckJobs` on intervals.

## Progress Tracking

```typescript
await ctx.setProgress(50); // 0–100, persisted to DB
```

Read via `queue.getJob(id)` (`progress` field) or React SDK's `useJob` hook.
