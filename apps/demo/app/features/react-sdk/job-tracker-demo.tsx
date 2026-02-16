'use client';

import { useCallback, useState, useTransition } from 'react';
import { DataqueueProvider, useJob } from '@nicnocquee/dataqueue-react';
import { addGenericJob } from '@/app/jobs/add-job';
import { processJobs } from '@/app/jobs/process-jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Loader2, Play, Eye, RotateCcw } from 'lucide-react';

const fetcher = (id: number) =>
  fetch(`/api/jobs/${id}`)
    .then((r) => r.json())
    .then((d) => d.job);

function StatusBadge({ status }: { status: string }) {
  const variant =
    {
      pending: 'outline' as const,
      processing: 'default' as const,
      completed: 'secondary' as const,
      failed: 'destructive' as const,
      cancelled: 'outline' as const,
      waiting: 'secondary' as const,
    }[status] ?? ('outline' as const);

  return (
    <Badge variant={variant} className="text-xs capitalize">
      {status}
    </Badge>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
      <div
        className="bg-primary h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function JobTrackerCard({ jobId }: { jobId: number }) {
  const [events, setEvents] = useState<string[]>([]);

  const addEvent = useCallback((msg: string) => {
    setEvents((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} — ${msg}`,
    ]);
  }, []);

  const { data, status, progress, isLoading, error } = useJob(jobId, {
    pollingInterval: 1000,
    onStatusChange: (newStatus, oldStatus) => {
      addEvent(`Status changed: ${oldStatus} → ${newStatus}`);
    },
    onComplete: () => {
      addEvent('Job completed successfully');
    },
    onFailed: (job) => {
      const reason = (job as Record<string, unknown>).failureReason;
      addEvent(`Job failed: ${reason ?? 'unknown error'}`);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Job #{jobId}</CardTitle>
            <CardDescription className="text-xs">
              Tracked via{' '}
              <code className="bg-muted px-1 py-0.5 rounded">
                useJob({jobId})
              </code>
            </CardDescription>
          </div>
          {status && <StatusBadge status={status} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading job data...
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error.message}
          </div>
        )}

        {data &&
          (() => {
            const job = data as Record<string, unknown>;
            return (
              <>
                {/* Progress */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-mono text-xs">{progress ?? 0}%</span>
                  </div>
                  <ProgressBar value={progress ?? 0} />
                </div>

                {/* Job details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div className="text-muted-foreground">Type</div>
                  <div className="font-mono text-xs">{String(job.jobType)}</div>
                  <div className="text-muted-foreground">Priority</div>
                  <div>{String(job.priority)}</div>
                  <div className="text-muted-foreground">Attempts</div>
                  <div>
                    {String(job.attempts)} / {String(job.maxAttempts)}
                  </div>
                  {job.payload != null && (
                    <>
                      <div className="text-muted-foreground">Payload</div>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate block">
                        {JSON.stringify(job.payload)}
                      </code>
                    </>
                  )}
                </div>
              </>
            );
          })()}

        {/* Event log */}
        {events.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium">Callback Events</h4>
            <div className="bg-muted/50 border rounded-md p-2 max-h-40 overflow-y-auto">
              {events.map((event, i) => (
                <div key={i} className="text-xs font-mono py-0.5">
                  {event}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function JobTrackerDemo() {
  const [trackedJobs, setTrackedJobs] = useState<number[]>([]);
  const [manualJobId, setManualJobId] = useState('');
  const [isPending, startTransition] = useTransition();

  const createAndTrack = (
    jobType: string,
    payload: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ) => {
    startTransition(async () => {
      const result = await addGenericJob({
        jobType: jobType as never,
        payload: payload as never,
        ...extra,
      });
      if (result.job) {
        setTrackedJobs((prev) => [result.job as number, ...prev]);
        // Trigger processing so the job runs
        await processJobs();
      }
    });
  };

  const trackManual = () => {
    const id = Number(manualJobId);
    if (id > 0 && !trackedJobs.includes(id)) {
      setTrackedJobs((prev) => [id, ...prev]);
      setManualJobId('');
    }
  };

  const clearAll = () => {
    setTrackedJobs([]);
  };

  return (
    <DataqueueProvider fetcher={fetcher} pollingInterval={1000}>
      <div className="space-y-6">
        {/* Create & Track */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create & Track Jobs</CardTitle>
            <CardDescription>
              Create a job and immediately start tracking it with{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                useJob
              </code>
              . The hook polls the API every second and fires callbacks on
              status changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  createAndTrack('send_email', {
                    to: `user${Date.now()}@example.com`,
                    subject: 'Welcome!',
                    body: 'Hello from Dataqueue!',
                  })
                }
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                <Play className="h-3 w-3 mr-1" />
                Email Job
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  createAndTrack('generate_report', {
                    reportId: `rpt-${Date.now()}`,
                    userId: '123',
                  })
                }
              >
                <Play className="h-3 w-3 mr-1" />
                Report Job
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  createAndTrack(
                    'generate_image',
                    { prompt: 'A beautiful sunset over mountains' },
                    { timeoutMs: 10000 },
                  )
                }
              >
                <Play className="h-3 w-3 mr-1" />
                Image Job (with timeout)
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  createAndTrack('data_pipeline', {
                    source: 'postgres://source-db',
                    destination: 's3://data-lake/output',
                  })
                }
              >
                <Play className="h-3 w-3 mr-1" />
                Pipeline Job (multi-step)
              </Button>
            </div>

            {/* Track existing job */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Enter a job ID to track..."
                value={manualJobId}
                onChange={(e) => setManualJobId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && trackManual()}
                className="max-w-[200px]"
              />
              <Button size="sm" variant="outline" onClick={trackManual}>
                <Eye className="h-3 w-3 mr-1" />
                Track
              </Button>
              {trackedJobs.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clearAll}>
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tracked jobs */}
        {trackedJobs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {trackedJobs.map((id) => (
              <JobTrackerCard key={id} jobId={id} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-sm text-muted-foreground">
                Create a job above or enter an existing job ID to start
                tracking. Each job card uses the{' '}
                <code className="bg-muted px-1 py-0.5 rounded">useJob</code>{' '}
                hook to poll for real-time status updates.
              </p>
            </CardContent>
          </Card>
        )}

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
            <CardDescription>
              The React SDK provides a simple polling-based approach to track
              jobs in real time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium">DataqueueProvider</h4>
                <p className="text-xs text-muted-foreground">
                  Wraps your app to provide a shared{' '}
                  <code className="bg-muted px-1 rounded">fetcher</code>{' '}
                  function and default{' '}
                  <code className="bg-muted px-1 rounded">pollingInterval</code>{' '}
                  to all
                  <code className="bg-muted px-1 rounded">useJob</code> hooks.
                </p>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium">useJob Hook</h4>
                <p className="text-xs text-muted-foreground">
                  Pass a job ID to start polling. Returns{' '}
                  <code className="bg-muted px-1 rounded">status</code>,{' '}
                  <code className="bg-muted px-1 rounded">progress</code>,{' '}
                  <code className="bg-muted px-1 rounded">data</code>, and{' '}
                  <code className="bg-muted px-1 rounded">isLoading</code>.
                  Stops automatically on terminal statuses.
                </p>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium">Lifecycle Callbacks</h4>
                <p className="text-xs text-muted-foreground">
                  <code className="bg-muted px-1 rounded">onStatusChange</code>,{' '}
                  <code className="bg-muted px-1 rounded">onComplete</code>, and{' '}
                  <code className="bg-muted px-1 rounded">onFailed</code> fire
                  when the job transitions between states.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DataqueueProvider>
  );
}
