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
import { addDataPipeline } from '@/app/jobs/data-pipeline';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

export function StepDemo() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Multi-Step Data Pipeline</CardTitle>
          <CardDescription>
            This job type runs 3 named steps using{' '}
            <code className="bg-muted px-0.5 rounded">ctx.run()</code>:
            fetch-data, transform-data, and load-data. Between each step, it
            waits 5 seconds using{' '}
            <code className="bg-muted px-0.5 rounded">ctx.waitFor()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await addDataPipeline({
                    source: 'postgres://analytics-db/events',
                    destination: 's3://data-lake/transformed',
                    tags: ['steps-demo'],
                  });
                  setResult(
                    `Pipeline job created: ID ${res.job}. Process it to watch the steps execute.`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Add Pipeline Job
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await processJobs();
                  setResult('Processing triggered');
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Process Jobs Now
            </Button>
          </div>

          {result && <p className="text-sm text-muted-foreground">{result}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How ctx.run() Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            Each call to{' '}
            <code className="bg-muted px-1 rounded">
              ctx.run(&quot;step-name&quot;, fn)
            </code>{' '}
            executes the function and persists its return value. On retry:
          </p>
          <div className="flex gap-2 flex-wrap">
            <div className="border rounded-md px-3 py-2 flex-1 min-w-[150px]">
              <p className="font-medium text-foreground text-xs">
                1. fetch-data
              </p>
              <p className="text-xs">
                Fetches rows from source. On retry, returns cached result.
              </p>
            </div>
            <div className="text-muted-foreground flex items-center">
              <code className="text-xs">waitFor(5s)</code>
            </div>
            <div className="border rounded-md px-3 py-2 flex-1 min-w-[150px]">
              <p className="font-medium text-foreground text-xs">
                2. transform-data
              </p>
              <p className="text-xs">
                Transforms rows. Skipped on retry if already done.
              </p>
            </div>
            <div className="text-muted-foreground flex items-center">
              <code className="text-xs">waitFor(5s)</code>
            </div>
            <div className="border rounded-md px-3 py-2 flex-1 min-w-[150px]">
              <p className="font-medium text-foreground text-xs">
                3. load-data
              </p>
              <p className="text-xs">
                Loads to destination. Last step to complete.
              </p>
            </div>
          </div>
          <p>
            If the job fails at step 3, retrying it will skip steps 1 and 2
            (using their cached results) and re-execute only step 3.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
