'use client';

import { useTransition, useState } from 'react';
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
import { completeToken } from '@/app/jobs/complete-token';
import { Loader2 } from 'lucide-react';

type SerializedJob = {
  id: number;
  jobType: string;
  status: string;
  waitTokenId?: string | null;
  waitUntil?: string | null;
  tags?: string[];
};

export function TokenList({ waitingJobs }: { waitingJobs: SerializedJob[] }) {
  const [isPending, startTransition] = useTransition();
  const [tokenData, setTokenData] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  const tokenWaiting = waitingJobs.filter((j) => j.waitTokenId);
  const timeWaiting = waitingJobs.filter((j) => j.waitUntil && !j.waitTokenId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Waiting Jobs - Tokens</CardTitle>
          <CardDescription>
            These jobs are waiting for a token to be completed. Enter optional
            data and click &quot;Complete Token&quot; to resume the job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokenWaiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No jobs waiting for tokens. Add an approval job and process it to
              see one here.
            </p>
          ) : (
            <div className="space-y-3">
              {tokenWaiting.map((job) => (
                <div
                  key={job.id}
                  className="border rounded-md px-3 py-2 space-y-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">#{job.id}</span>
                    <span>{job.jobType}</span>
                    <Badge variant="secondary" className="text-xs">
                      waiting for token
                    </Badge>
                    <code className="text-xs bg-muted px-1 rounded">
                      {job.waitTokenId}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder='Optional data JSON, e.g. {"approved": true}'
                      className="text-xs"
                      value={tokenData[job.waitTokenId!] ?? ''}
                      onChange={(e) =>
                        setTokenData((prev) => ({
                          ...prev,
                          [job.waitTokenId!]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          const dataStr = tokenData[job.waitTokenId!];
                          let data: Record<string, unknown> | undefined;
                          if (dataStr) {
                            try {
                              data = JSON.parse(dataStr);
                            } catch {
                              setResult('Invalid JSON data');
                              return;
                            }
                          }
                          await completeToken(job.waitTokenId!, data);
                          setResult(
                            `Token ${job.waitTokenId} completed. Job #${job.id} will resume on next process.`,
                          );
                        })
                      }
                    >
                      {isPending && (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      )}
                      Complete Token
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {timeWaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting Jobs - Time-Based</CardTitle>
            <CardDescription>
              These jobs are paused with{' '}
              <code className="bg-muted px-0.5 rounded">ctx.waitFor()</code> or{' '}
              <code className="bg-muted px-0.5 rounded">ctx.waitUntil()</code>{' '}
              and will automatically resume.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {timeWaiting.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm"
                >
                  <span className="font-mono">#{job.id}</span>
                  <span>{job.jobType}</span>
                  <Badge variant="secondary" className="text-xs">
                    waiting until{' '}
                    {job.waitUntil
                      ? new Date(job.waitUntil).toLocaleTimeString()
                      : '?'}
                  </Badge>
                  {job.tags?.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {result && <p className="text-sm text-muted-foreground">{result}</p>}
    </div>
  );
}
