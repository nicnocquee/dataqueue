---
name: dataqueue-react
description: React SDK and Dashboard patterns for DataQueue — useJob hook, DataqueueProvider, admin dashboard.
---

# DataQueue React & Dashboard Patterns

## React SDK — @nicnocquee/dataqueue-react

### Installation

```bash
npm install @nicnocquee/dataqueue-react
```

Requires React 18+.

### useJob Hook

Poll a job's status and progress from the browser.

```tsx
'use client';
import { useJob } from '@nicnocquee/dataqueue-react';

function JobTracker({ jobId }: { jobId: number }) {
  const { status, progress, data, isLoading, error } = useJob(jobId, {
    fetcher: (id) =>
      fetch(`/api/jobs/${id}`)
        .then((r) => r.json())
        .then((d) => d.job),
    pollingInterval: 1000,
    onComplete: (job) => toast.success('Done!'),
    onFailed: (job) => toast.error('Failed'),
    onStatusChange: (newStatus, oldStatus) => {
      console.log(`${oldStatus} → ${newStatus}`);
    },
  });

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <p>Status: {status}</p>
      <progress value={progress ?? 0} max={100} />
    </div>
  );
}
```

Polling stops automatically on terminal statuses (`completed`, `failed`, `cancelled`).

### DataqueueProvider

Avoid repeating `fetcher` and `pollingInterval` by wrapping your app in a provider.

```tsx
'use client';
import { DataqueueProvider } from '@nicnocquee/dataqueue-react';

const fetcher = (id: number) =>
  fetch(`/api/jobs/${id}`)
    .then((r) => r.json())
    .then((d) => d.job);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DataqueueProvider fetcher={fetcher} pollingInterval={2000}>
      {children}
    </DataqueueProvider>
  );
}
```

Then use `useJob` without config:

```tsx
const { status, progress } = useJob(jobId);
```

### API Route for Job Fetching (Next.js)

```typescript
// app/api/jobs/[id]/route.ts
import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const jobQueue = getJobQueue();
  const job = await jobQueue.getJob(Number(id));
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  return NextResponse.json({ job });
}
```

### useJob Return Value

| Field       | Type                | Description                                           |
| ----------- | ------------------- | ----------------------------------------------------- |
| `data`      | `JobData \| null`   | Latest job data from fetcher                          |
| `status`    | `JobStatus \| null` | Current job status                                    |
| `progress`  | `number \| null`    | Progress percentage (0–100)                           |
| `output`    | `unknown \| null`   | Handler output from `ctx.setOutput()` or return value |
| `isLoading` | `boolean`           | True until first fetch resolves                       |
| `error`     | `Error \| null`     | Last fetch error                                      |

## Dashboard — @nicnocquee/dataqueue-dashboard

### Installation

```bash
npm install @nicnocquee/dataqueue-dashboard
```

### Setup (Next.js App Router)

Create a single catch-all route:

```typescript
// app/admin/dataqueue/[[...path]]/route.ts
import { createDataqueueDashboard } from '@nicnocquee/dataqueue-dashboard/next';
import { getJobQueue, jobHandlers } from '@/lib/queue';

const { GET, POST } = createDataqueueDashboard({
  jobQueue: getJobQueue(),
  jobHandlers,
  basePath: '/admin/dataqueue',
});

export { GET, POST };
```

Visit `/admin/dataqueue` to open the dashboard.

The `basePath` must match the route file directory. For example, `app/jobs/dashboard/[[...path]]/route.ts` requires `basePath: '/jobs/dashboard'`.

### Dashboard Features

- Jobs list with status filter tabs, pagination, auto-refresh
- Job detail view with payload, error history, step data, events timeline
- Inline actions: cancel pending/waiting jobs, retry failed/cancelled jobs
- Process Jobs button for one-shot processing (useful in dev)

### Protecting the Dashboard

Wrap the handlers with your auth logic:

```typescript
const dashboard = createDataqueueDashboard({
  jobQueue: getJobQueue(),
  jobHandlers,
  basePath: '/admin/dataqueue',
});

export async function GET(req: Request, ctx: any) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return new Response('Unauthorized', { status: 401 });
  }
  return dashboard.GET(req, ctx);
}

export async function POST(req: Request, ctx: any) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return new Response('Unauthorized', { status: 401 });
  }
  return dashboard.POST(req, ctx);
}
```

### Progress Tracking from Handlers

Report progress via `ctx.setProgress(percent)` (0–100). The value persists to the database and is exposed via `getJob()` and the `useJob` hook's `progress` field.

```typescript
const handler = async (payload, signal, ctx) => {
  for (let i = 0; i < chunks.length; i++) {
    await processChunk(chunks[i]);
    await ctx.setProgress(Math.round(((i + 1) / chunks.length) * 100));
  }
};
```

### Job Output from Handlers

Store results via `ctx.setOutput(data)` or by returning a value from the handler. Exposed via `getJob()` (`output` field) and the `useJob` hook's `output` property. If both are used, `ctx.setOutput()` takes precedence.

```typescript
const handler = async (payload, signal, ctx) => {
  const result = await doWork(payload);
  return { url: result.downloadUrl }; // stored as output
};
```
