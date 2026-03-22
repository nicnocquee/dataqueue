'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { addGenericJob } from '@/app/jobs/add-job';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

/**
 * Interactive demos for `dependsOn.jobIds` (linear prerequisites) and
 * `dependsOn.tags` (tag drain: wait until no other active job is tagged as a superset).
 */
export function DependencyDemo() {
  const [isPending, startTransition] = useTransition();
  const [log, setLog] = useState<string | null>(null);

  const runChain = () => {
    startTransition(async () => {
      const a = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'chain — step A' },
        tags: ['demo-deps', 'chain'],
      });
      const b = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'chain — step B' },
        tags: ['demo-deps', 'chain'],
        dependsOn: { jobIds: [a.job] },
      });
      const c = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'chain — step C' },
        tags: ['demo-deps', 'chain'],
        dependsOn: { jobIds: [b.job] },
      });
      setLog(
        `Enqueued linear chain: A=#${a.job} → B=#${b.job} (waits on A) → C=#${c.job} (waits on B). Run the processor to watch order.`,
      );
    });
  };

  const runTagBarrier = () => {
    startTransition(async () => {
      const wave = `wave-${Date.now()}`;
      const j1 = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'parallel slot 1' },
        tags: ['demo-deps', wave, 'slot-1'],
      });
      const j2 = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'parallel slot 2' },
        tags: ['demo-deps', wave, 'slot-2'],
      });
      const barrier = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'after wave (tag drain)' },
        tags: ['demo-deps', wave, 'barrier'],
        dependsOn: { tags: [wave] },
      });
      setLog(
        `Tag “${wave}”: parallel jobs #${j1.job} and #${j2.job} must finish (or leave the active set) before #${barrier.job} runs — barrier waits while any job still has tag [${wave}].`,
      );
    });
  };

  const runFailureCascade = () => {
    startTransition(async () => {
      const bad = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'fails on purpose', fail: true },
        tags: ['demo-deps', 'fail-cascade'],
        maxAttempts: 1,
      });
      const dep = await addGenericJob({
        jobType: 'dep_demo',
        payload: { label: 'cancelled when prerequisite fails' },
        tags: ['demo-deps', 'fail-cascade'],
        dependsOn: { jobIds: [bad.job] },
      });
      setLog(
        `Enqueued prerequisite #${bad.job} (will fail once) and dependent #${dep.job}. After processing, #${dep.job} should end cancelled.`,
      );
    });
  };

  const triggerProcessor = () => {
    startTransition(async () => {
      await processJobs();
      setLog((prev) =>
        prev
          ? `${prev}\nProcessor tick complete — refresh the table below.`
          : 'Processor tick complete — refresh the table below.',
      );
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Linear chain (`dependsOn.jobIds`)</CardTitle>
          <CardDescription>
            B waits until job A is completed; C waits until B is completed.
            Prerequisite failures or cancellations propagate to dependents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={runChain} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enqueue A → B → C
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tag drain (`dependsOn.tags`)</CardTitle>
          <CardDescription>
            The barrier job waits until no <em>active</em> job (pending,
            processing, or waiting) still includes all of those tags. Parallel
            work can run; the barrier runs after the wave clears.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={runTagBarrier}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enqueue parallel wave + barrier
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Failure cascade</CardTitle>
          <CardDescription>
            A job that fails (here: single attempt, intentional throw) cancels
            jobs that depend on it by job id.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            onClick={runFailureCascade}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enqueue failing job + dependent
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run the processor</CardTitle>
          <CardDescription>
            Same as other demos: jobs move when the processor runs (manual
            button here, or Auto Processor on the home page).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={triggerProcessor}
            disabled={isPending}
          >
            Process jobs now
          </Button>
        </CardContent>
      </Card>

      {log && (
        <p className="text-sm rounded-md border bg-muted/40 px-3 py-2 whitespace-pre-wrap">
          {log}
        </p>
      )}
    </div>
  );
}
