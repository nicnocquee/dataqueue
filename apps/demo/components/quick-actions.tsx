'use client';

import { Button } from '@/components/ui/button';
import { useTransition } from 'react';
import { addGenericJob } from '@/app/jobs/add-job';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

export function QuickActions() {
  const [isPending, startTransition] = useTransition();

  const quickAdd = (
    jobType: string,
    payload: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ) => {
    startTransition(async () => {
      await addGenericJob({
        jobType: jobType as never,
        payload: payload as never,
        ...extra,
      });
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          quickAdd('send_email', {
            to: `user${Date.now()}@example.com`,
            subject: 'Welcome!',
            body: 'Hello from Dataqueue!',
          })
        }
      >
        {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        Add Email Job
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          quickAdd('generate_report', {
            reportId: `rpt-${Date.now()}`,
            userId: '123',
          })
        }
      >
        Add Report Job
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          quickAdd(
            'generate_image',
            { prompt: 'A beautiful sunset over mountains' },
            { timeoutMs: 5000 },
          )
        }
      >
        Add Image Job
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          quickAdd('data_pipeline', {
            source: 'postgres://source-db',
            destination: 's3://data-lake/output',
          })
        }
      >
        Add Pipeline Job
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          quickAdd('approval_request', {
            requestType: 'deploy',
            description: 'Deploy v2.0 to production',
          })
        }
      >
        Add Approval Job
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await processJobs();
          });
        }}
      >
        {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        Process Jobs Now
      </Button>
    </div>
  );
}
