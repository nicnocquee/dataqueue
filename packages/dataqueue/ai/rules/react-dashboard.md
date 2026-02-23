# DataQueue — React & Dashboard Rules

## React SDK (@nicnocquee/dataqueue-react)

Install: `npm install @nicnocquee/dataqueue-react` (requires React 18+).

### useJob Hook

```tsx
'use client';
import { useJob } from '@nicnocquee/dataqueue-react';

const { status, progress, output, data, isLoading, error } = useJob(jobId, {
  fetcher: (id) =>
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => d.job),
  pollingInterval: 1000,
  onComplete: (job) => {
    /* job completed */
  },
  onFailed: (job) => {
    /* job failed */
  },
});
```

Polling auto-stops on terminal statuses (`completed`, `failed`, `cancelled`).

### DataqueueProvider

Wrap app in `DataqueueProvider` to share `fetcher` and `pollingInterval`:

```tsx
<DataqueueProvider fetcher={fetcher} pollingInterval={2000}>
  {children}
</DataqueueProvider>
```

### API Route (Next.js)

```typescript
// app/api/jobs/[id]/route.ts
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJobQueue().getJob(Number(id));
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ job });
}
```

## Dashboard (@nicnocquee/dataqueue-dashboard)

Install: `npm install @nicnocquee/dataqueue-dashboard`.

### Setup (Next.js App Router)

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

`basePath` must match the route directory path.

### Protection

Wrap handlers with your auth middleware before exporting GET/POST.

## Progress Tracking

Use `ctx.setProgress(percent)` in handlers (0–100). The value appears in `useJob`'s `progress` field and the dashboard detail view.

## Job Output

Store results via `ctx.setOutput(data)` or by returning a value from the handler. The value appears in `useJob`'s `output` field and the dashboard detail view. If both are used, `ctx.setOutput()` takes precedence.
