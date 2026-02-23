---
name: dataqueue-core
description: Core patterns for using @nicnocquee/dataqueue — typed PayloadMap, init, handlers, adding and processing jobs.
---

# DataQueue Core Patterns

## Imports

Always import from `@nicnocquee/dataqueue`. There is no v2/v3 subpath.

```typescript
import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';
```

## Step 1: Define a PayloadMap

Define an object type mapping job type strings to their payload shapes. This is the foundation of type safety — every API method is generic over this map.

```typescript
export type JobPayloadMap = {
  send_email: { to: string; subject: string; body: string };
  generate_report: { reportId: string; userId: string };
};
```

## Step 2: Define Handlers

Create a `JobHandlers<PayloadMap>` object. TypeScript enforces that every key in the PayloadMap has a handler. Each handler receives `(payload, signal, ctx)`.

```typescript
import { JobHandlers } from '@nicnocquee/dataqueue';
import type { JobPayloadMap } from './types';

export const jobHandlers: JobHandlers<JobPayloadMap> = {
  send_email: async (payload) => {
    await sendEmail(payload.to, payload.subject, payload.body);
  },
  generate_report: async (payload, signal) => {
    if (signal.aborted) return;
    await generateReport(payload.reportId, payload.userId);
  },
};
```

## Step 3: Initialize the Queue (Singleton)

Use a module-level singleton. Each `initJobQueue` call creates a new database pool — never call it per-request.

### PostgreSQL

```typescript
import { initJobQueue } from '@nicnocquee/dataqueue';
import type { JobPayloadMap } from './types';

let jobQueue: ReturnType<typeof initJobQueue<JobPayloadMap>> | null = null;

export const getJobQueue = () => {
  if (!jobQueue) {
    jobQueue = initJobQueue<JobPayloadMap>({
      databaseConfig: {
        connectionString: process.env.PG_DATAQUEUE_DATABASE,
      },
    });
  }
  return jobQueue;
};
```

### Redis

```typescript
jobQueue = initJobQueue<JobPayloadMap>({
  backend: 'redis',
  redisConfig: {
    url: process.env.REDIS_URL,
    keyPrefix: 'myapp:',
  },
});
```

## Step 4: Add Jobs

```typescript
const jobId = await queue.addJob({
  jobType: 'send_email',
  payload: { to: 'user@example.com', subject: 'Hi', body: 'Hello' },
  priority: 10,
  runAt: new Date(Date.now() + 5000),
  tags: ['welcome'],
  idempotencyKey: 'welcome-user-123',
});
```

## Step 5: Process Jobs

### Serverless (one-shot)

```typescript
const processor = queue.createProcessor(handlers, {
  batchSize: 10,
  concurrency: 3,
});
const processed = await processor.start();
```

### Long-running server

```typescript
const processor = queue.createProcessor(handlers, {
  batchSize: 10,
  concurrency: 3,
  pollInterval: 5000,
});
processor.startInBackground();

process.on('SIGTERM', async () => {
  await processor.stopAndDrain(30000);
  queue.getPool().end();
  process.exit(0);
});
```

## Common Mistakes

1. **Creating a new queue per request** — always use a singleton. Each `initJobQueue` creates a DB pool.
2. **Missing handler for a job type** — the job fails with `FailureReason.NoHandler`. Let TypeScript enforce completeness by typing handlers as `JobHandlers<PayloadMap>`.
3. **Not checking `signal.aborted`** — timed-out jobs keep running in the background. Always check the signal in long-running handlers.
4. **Forgetting `reclaimStuckJobs`** — crashed workers leave jobs stuck in `processing`. Call `reclaimStuckJobs()` periodically.
5. **Forgetting to run migrations** — PostgreSQL requires `dataqueue-cli migrate` before use. Redis needs no migrations.
6. **Not calling `stopAndDrain` on shutdown** — use `stopAndDrain()` (not `stop()`) for graceful shutdown to avoid stuck jobs.
