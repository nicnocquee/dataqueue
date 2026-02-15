'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { useJob, DataqueueProvider } from '@nicnocquee/dataqueue-react';

const fetcher = (id: number) =>
  fetch(`/api/jobs/${id}`)
    .then((r) => r.json())
    .then((d) => d.job);

function JobTracker() {
  const searchParams = useSearchParams();
  const jobIdParam = searchParams.get('jobId');
  const jobId = jobIdParam ? Number(jobIdParam) : null;
  const interval = Number(searchParams.get('interval') ?? '500');

  const [events, setEvents] = useState<string[]>([]);

  const addEvent = useCallback((msg: string) => {
    setEvents((prev) => [...prev, msg]);
  }, []);

  const { data, status, progress, isLoading, error } = useJob(jobId, {
    fetcher,
    pollingInterval: interval,
    onStatusChange: (newStatus, oldStatus) => {
      addEvent(`status:${oldStatus}->${newStatus}`);
    },
    onComplete: () => {
      addEvent('callback:complete');
    },
    onFailed: () => {
      addEvent('callback:failed');
    },
  });

  return (
    <div>
      <h1>React SDK E2E Test</h1>

      <div data-testid="job-id">{jobId ?? 'none'}</div>
      <div data-testid="status">{status ?? 'none'}</div>
      <div data-testid="progress">{progress ?? 'none'}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      <div data-testid="error">{error ? error.message : 'none'}</div>
      <div data-testid="job-type">{(data as any)?.jobType ?? 'none'}</div>

      <ul data-testid="events">
        {events.map((e, i) => (
          <li key={i} data-testid={`event-${i}`}>
            {e}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReactSdkPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DataqueueProvider fetcher={fetcher} pollingInterval={500}>
        <JobTracker />
      </DataqueueProvider>
    </Suspense>
  );
}
