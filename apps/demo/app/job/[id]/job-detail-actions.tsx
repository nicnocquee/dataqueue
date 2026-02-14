'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { retryJob } from '@/app/jobs/retry';
import { cancelSingleJob } from '@/app/jobs/cancel-job';
import { completeToken } from '@/app/jobs/complete-token';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

type SerializedJob = {
  id: number;
  status: string;
  waitTokenId?: string | null;
};

export function JobDetailActions({ job }: { job: SerializedJob }) {
  const [isPending, startTransition] = useTransition();
  const [tokenData, setTokenData] = useState('');
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(job.status === 'failed' || job.status === 'cancelled') && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await retryJob(job.id);
              setResult('Job retried');
            })
          }
        >
          {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          Retry Job
        </Button>
      )}
      {job.status === 'pending' && (
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await cancelSingleJob(job.id);
              setResult('Job cancelled');
            })
          }
        >
          Cancel Job
        </Button>
      )}
      {job.status === 'waiting' && job.waitTokenId && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Token data JSON (optional)"
            className="text-xs w-64"
            value={tokenData}
            onChange={(e) => setTokenData(e.target.value)}
          />
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                let data: Record<string, unknown> | undefined;
                if (tokenData) {
                  try {
                    data = JSON.parse(tokenData);
                  } catch {
                    setResult('Invalid JSON');
                    return;
                  }
                }
                await completeToken(job.waitTokenId!, data);
                setResult('Token completed');
              })
            }
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Complete Token
          </Button>
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await processJobs();
            setResult('Processing triggered');
          })
        }
      >
        Process Jobs Now
      </Button>
      {result && (
        <span className="text-sm text-muted-foreground">{result}</span>
      )}
    </div>
  );
}
