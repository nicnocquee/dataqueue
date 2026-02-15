# @nicnocquee/dataqueue-react

React hooks for subscribing to [dataqueue](https://github.com/nicnocquee/dataqueue) job status and progress.

## Installation

```bash
npm install @nicnocquee/dataqueue-react
```

Requires React 18+.

## Quick Start

```tsx
import { useJob } from '@nicnocquee/dataqueue-react';

function JobTracker({ jobId }: { jobId: number }) {
  const { status, progress, isLoading, error } = useJob(jobId, {
    fetcher: (id) =>
      fetch(`/api/jobs/${id}`)
        .then((r) => r.json())
        .then((d) => d.job),
    pollingInterval: 1000,
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

## Provider

Use `DataqueueProvider` to share config across your app:

```tsx
import { DataqueueProvider } from '@nicnocquee/dataqueue-react';

function App() {
  return (
    <DataqueueProvider
      fetcher={(id) =>
        fetch(`/api/jobs/${id}`)
          .then((r) => r.json())
          .then((d) => d.job)
      }
      pollingInterval={2000}
    >
      <YourApp />
    </DataqueueProvider>
  );
}
```

Then use `useJob` anywhere without repeating the fetcher:

```tsx
const { status, progress } = useJob(jobId);
```

## API

### useJob(jobId, options?)

| Option            | Type                               | Default       | Description                       |
| ----------------- | ---------------------------------- | ------------- | --------------------------------- |
| `fetcher`         | `(id: number) => Promise<JobData>` | from provider | Function that fetches a job by ID |
| `pollingInterval` | `number`                           | `1000`        | Milliseconds between polls        |
| `enabled`         | `boolean`                          | `true`        | Set to `false` to pause polling   |
| `onStatusChange`  | `(newStatus, oldStatus) => void`   | —             | Called when status changes        |
| `onComplete`      | `(job) => void`                    | —             | Called when job completes         |
| `onFailed`        | `(job) => void`                    | —             | Called when job fails             |

Returns `{ data, status, progress, isLoading, error }`.

Polling stops automatically when the job reaches a terminal status (`completed`, `failed`, `cancelled`).

## Documentation

Full documentation: [dataqueue docs](https://dataqueue.nico.fyi/docs/usage/react-sdk)

## License

MIT
