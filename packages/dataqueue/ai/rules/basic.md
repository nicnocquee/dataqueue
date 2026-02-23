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

**Long-running** — call `processor.startInBackground()` which polls continuously:

```typescript
processor.startInBackground();
process.on('SIGTERM', async () => {
  await processor.stopAndDrain(30000);
  queue.getPool().end(); // or queue.getRedisClient().quit() for Redis
  process.exit(0);
});
```

## Common Mistakes

1. Creating `initJobQueue` per request — use a singleton.
2. Missing handler for a job type — fails with `NoHandler`. Type as `JobHandlers<PayloadMap>`.
3. Not checking `signal.aborted` in long handlers — timed-out jobs keep running.
4. Forgetting `reclaimStuckJobs()` — crashed workers leave jobs stuck.
5. Skipping migrations (PostgreSQL) — run `dataqueue-cli migrate` first. Redis needs none.
6. Using `stop()` instead of `stopAndDrain()` — leaves in-flight jobs stuck.
