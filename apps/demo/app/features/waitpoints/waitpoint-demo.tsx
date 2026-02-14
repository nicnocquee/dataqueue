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
import { addApprovalRequest } from '@/app/jobs/approval-request';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

export function WaitpointDemo() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Wait for Duration</CardTitle>
            <CardDescription className="text-xs">
              Creates a data_pipeline job that uses{' '}
              <code className="bg-muted px-0.5 rounded">
                ctx.waitFor(&#123; seconds: 5 &#125;)
              </code>{' '}
              between steps. The job will transition to &quot;waiting&quot;
              status and automatically resume after the wait.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await addGenericJob({
                    jobType: 'data_pipeline',
                    payload: {
                      source: 'postgres://source-db',
                      destination: 's3://data-lake/output',
                    },
                    tags: ['waitpoint-demo', 'duration'],
                  });
                  setResult(
                    `Pipeline job created: ID ${res.job}. Process it to see the wait behavior.`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Add Pipeline Job (with waits)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Human-in-the-Loop (Token)</CardTitle>
            <CardDescription className="text-xs">
              Creates an approval_request job that calls{' '}
              <code className="bg-muted px-0.5 rounded">ctx.createToken()</code>{' '}
              then{' '}
              <code className="bg-muted px-0.5 rounded">
                ctx.waitForToken(tokenId)
              </code>
              . The job pauses until you manually complete the token below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await addApprovalRequest({
                    requestType: 'deploy',
                    description: `Deploy v${Math.floor(Math.random() * 10)}.0 to production`,
                    tags: ['waitpoint-demo', 'token'],
                  });
                  setResult(
                    `Approval job created: ID ${res.job}. Process it, then complete the token to resume.`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Add Approval Job (token wait)
            </Button>
          </CardContent>
        </Card>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await processJobs();
            setResult('Processing triggered - check job statuses below');
          })
        }
      >
        {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        Process Jobs Now
      </Button>

      {result && <p className="text-sm text-muted-foreground">{result}</p>}
    </div>
  );
}
