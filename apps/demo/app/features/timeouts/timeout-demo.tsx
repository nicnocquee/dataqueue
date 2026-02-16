'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { addGenericJob } from '@/app/jobs/add-job';

export function TimeoutDemo() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const addAndNotify = async (
    description: string,
    opts: Parameters<typeof addGenericJob>[0],
  ) => {
    const res = await addGenericJob(opts);
    setResult(`${description} - Job ID: ${res.job}`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Timeout Scenarios</CardTitle>
          <CardDescription>
            Each button creates a generate_image job with different timeout
            configurations. The handler simulates 8-9 seconds of work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Basic Timeout (5s)</CardTitle>
                <CardDescription className="text-xs">
                  Job takes ~8s but has 5s timeout. Will fail with
                  &quot;timeout&quot; reason since the handler takes longer than
                  allowed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(() =>
                      addAndNotify('Basic timeout job', {
                        jobType: 'generate_image',
                        payload: { prompt: 'timeout-basic' },
                        timeoutMs: 5000,
                        tags: ['timeout-demo', 'basic'],
                      }),
                    )
                  }
                >
                  Add Job (5s timeout)
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  With onTimeout + Extend
                </CardTitle>
                <CardDescription className="text-xs">
                  Handler registers{' '}
                  <code className="bg-muted px-0.5 rounded">ctx.onTimeout</code>{' '}
                  that extends the deadline by 5s when timeout approaches. May
                  succeed if extension is enough.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(() =>
                      addAndNotify('onTimeout extend job', {
                        jobType: 'generate_image',
                        payload: { prompt: 'timeout-extend' },
                        timeoutMs: 5000,
                        tags: ['timeout-demo', 'on-timeout'],
                      }),
                    )
                  }
                >
                  Add Job (onTimeout extend)
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  With Prolong (Heartbeat)
                </CardTitle>
                <CardDescription className="text-xs">
                  Handler calls{' '}
                  <code className="bg-muted px-0.5 rounded">
                    ctx.prolong(3000)
                  </code>{' '}
                  which resets the timeout deadline by 3s each time. Acts as a
                  heartbeat to keep the job alive.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(() =>
                      addAndNotify('Prolong heartbeat job', {
                        jobType: 'generate_image',
                        payload: { prompt: 'timeout-prolong' },
                        timeoutMs: 5000,
                        tags: ['timeout-demo', 'prolong'],
                      }),
                    )
                  }
                >
                  Add Job (prolong heartbeat)
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Force Kill on Timeout</CardTitle>
                <CardDescription className="text-xs">
                  Uses Worker Threads to forcefully terminate the job when
                  timeout is reached. The handler cannot prevent termination.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(() =>
                      addAndNotify('Force kill job', {
                        jobType: 'generate_image',
                        payload: { prompt: 'timeout-force-kill' },
                        timeoutMs: 5000,
                        forceKillOnTimeout: true,
                        tags: ['timeout-demo', 'force-kill'],
                      }),
                    )
                  }
                >
                  Add Job (force kill)
                </Button>
              </CardContent>
            </Card>
          </div>

          {result && <p className="text-sm text-muted-foreground">{result}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How Timeout Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>timeoutMs</strong>: Set a deadline. When reached, the
              AbortSignal is triggered.
            </li>
            <li>
              <strong>ctx.prolong(ms)</strong>: Reset the deadline from now.
              Call periodically as a heartbeat.
            </li>
            <li>
              <strong>ctx.onTimeout(callback)</strong>: Called just before
              timeout. Can extend the deadline.
            </li>
            <li>
              <strong>forceKillOnTimeout</strong>: Runs the handler in a Worker
              Thread and terminates it on timeout. The handler cannot prevent
              this.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
