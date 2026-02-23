# DataQueue — Basic Rules

## Imports

Always import from `@nicnocquee/dataqueue`. There is no subpath like `/v2` or `/v3`.

```typescript
import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';
```

## PayloadMap Pattern

Define an object type where keys are job type strings and values are payload shapes. This powers type-safe `addJob`, `createProcessor`, and handler completeness checking.

```typescript
type JobPayloadMap = {
  send_email: { to: string; subject: string; body: string };
  generate_report: { reportId: string; userId: string };
};
```

## Initialization (Singleton)

Never call `initJobQueue` per request — each call creates a new database connection pool. Use a module-level singleton:

```typescript
import { initJobQueue } from '@nicnocquee/dataqueue';

let jobQueue: ReturnType<typeof initJobQueue<JobPayloadMap>> | null = null;

export const getJobQueue = () => {
  if (!jobQueue) {
    jobQueue = initJobQueue<JobPayloadMap>({
      databaseConfig: { connectionString: process.env.PG_DATAQUEUE_DATABASE },
    });
  }
  return jobQueue;
};
```

For Redis, set `backend: 'redis'` and use `redisConfig` with `url` or `host`/`port`/`password`. Install `ioredis` as a peer dependency.

### Bring Your Own Pool / Client

Pass an existing `pg.Pool` or `ioredis` client instead of connection config:

```typescript
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
jobQueue = initJobQueue<JobPayloadMap>({ pool });
```

```typescript
import IORedis from 'ioredis';
const redis = new IORedis(process.env.REDIS_URL);
jobQueue = initJobQueue<JobPayloadMap>({
  backend: 'redis',
  client: redis,
  keyPrefix: 'myapp:',
});
```

The library will **not** close externally provided connections on shutdown.

## Adding Jobs

Use `addJob` for a single job, `addJobs` for bulk inserts (single DB round-trip).

```typescript
const id = await queue.addJob({
  jobType: 'send_email',
  payload: { to: 'a@x.com', subject: 'Hi', body: '...' },
});

const ids = await queue.addJobs([
  {
    jobType: 'send_email',
    payload: { to: 'a@x.com', subject: 'Hi', body: '...' },
  },
  {
    jobType: 'send_email',
    payload: { to: 'b@x.com', subject: 'Hi', body: '...' },
    priority: 10,
  },
]);
// ids[i] corresponds to the i-th input job
```

Both support `idempotencyKey`, `priority`, `runAt`, `tags`, and `{ db }` for transactional inserts (PostgreSQL only).

## Handlers

Type handlers as `JobHandlers<PayloadMap>` so TypeScript enforces a handler for every job type.

```typescript
export const jobHandlers: JobHandlers<JobPayloadMap> = {
  send_email: async (payload, signal, ctx) => {
    await sendEmail(payload.to, payload.subject, payload.body);
  },
  generate_report: async (payload) => {
    await generateReport(payload.reportId, payload.userId);
  },
};
```

Handler signature: `(payload: T, signal: AbortSignal, ctx: JobContext) => Promise<void>`. You can omit arguments you don't need.

## Processing

**Serverless** — call `processor.start()` which processes one batch and stops:

```typescript
const processor = queue.createProcessor(handlers, {
  batchSize: 10,
  concurrency: 3,
});
await processor.start();
```

**Long-running** — call `processor.startInBackground()` which polls continuously, and `createSupervisor()` to automate maintenance:

```typescript
processor.startInBackground();

const supervisor = queue.createSupervisor({
  intervalMs: 60_000,
  stuckJobsTimeoutMinutes: 10,
  cleanupJobsDaysToKeep: 30,
});
supervisor.startInBackground();

process.on('SIGTERM', async () => {
  await Promise.all([
    processor.stopAndDrain(30000),
    supervisor.stopAndDrain(30000),
  ]);
  queue.getPool().end(); // or queue.getRedisClient().quit() for Redis
  process.exit(0);
});
```

## Retry Configuration

Control retry behavior per-job with optional fields on `addJob`:

- `retryDelay` (seconds, default 60) — base delay between retries.
- `retryBackoff` (boolean, default true) — enable exponential backoff with jitter.
- `retryDelayMax` (seconds, optional) — cap the maximum delay.

When none are set, the legacy `2^attempts * 60s` formula is used.

## Common Mistakes

1. Creating `initJobQueue` per request — use a singleton.
2. Missing handler for a job type — fails with `NoHandler`. Type as `JobHandlers<PayloadMap>`.
3. Not checking `signal.aborted` in long handlers — timed-out jobs keep running.
4. Skipping maintenance — use `createSupervisor()` to automate reclaim, cleanup, and token expiry. Without it, stuck jobs and old data accumulate.
5. Skipping migrations (PostgreSQL) — run `dataqueue-cli migrate` first. Redis needs none.
6. Using `stop()` instead of `stopAndDrain()` — leaves in-flight jobs stuck.
