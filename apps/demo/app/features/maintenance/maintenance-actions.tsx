'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cleanupOldJobs, cleanupOldJobEvents } from '@/app/jobs/cleanup-events';
import { reclaimStuckJobs } from '@/app/jobs/reclaim';
import { Loader2 } from 'lucide-react';

export function MaintenanceActions() {
  const [isPending, startTransition] = useTransition();
  const [jobDays, setJobDays] = useState('30');
  const [eventDays, setEventDays] = useState('30');
  const [reclaimMinutes, setReclaimMinutes] = useState('10');
  const [results, setResults] = useState<string[]>([]);

  const addResult = (msg: string) => {
    setResults((prev) => [msg, ...prev].slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cleanup Old Jobs</CardTitle>
            <CardDescription className="text-xs">
              Delete completed jobs older than N days using{' '}
              <code className="bg-muted px-0.5 rounded">
                cleanupOldJobs(days)
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Days to keep</Label>
              <Input
                type="number"
                value={jobDays}
                onChange={(e) => setJobDays(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await cleanupOldJobs(Number(jobDays));
                  addResult(
                    `Cleaned up ${res.deleted} old job(s) (keeping ${jobDays} days)`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Run Cleanup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cleanup Old Events</CardTitle>
            <CardDescription className="text-xs">
              Delete job events older than N days using{' '}
              <code className="bg-muted px-0.5 rounded">
                cleanupOldJobEvents(days)
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Days to keep</Label>
              <Input
                type="number"
                value={eventDays}
                onChange={(e) => setEventDays(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await cleanupOldJobEvents(Number(eventDays));
                  addResult(
                    `Cleaned up ${res.deleted} old event(s) (keeping ${eventDays} days)`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Run Cleanup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reclaim Stuck Jobs</CardTitle>
            <CardDescription className="text-xs">
              Reset jobs stuck in &quot;processing&quot; state using{' '}
              <code className="bg-muted px-0.5 rounded">
                reclaimStuckJobs(minutes)
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Max processing time (minutes)</Label>
              <Input
                type="number"
                value={reclaimMinutes}
                onChange={(e) => setReclaimMinutes(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await reclaimStuckJobs(Number(reclaimMinutes));
                  addResult(
                    `Reclaimed ${res.reclaimed} stuck job(s) (>${reclaimMinutes} min)`,
                  );
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Reclaim Jobs
            </Button>
          </CardContent>
        </Card>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {results.map((r, i) => (
                <p key={i} className="text-sm text-muted-foreground font-mono">
                  {r}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Maintenance Best Practices</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Run <strong>cleanupOldJobs</strong> periodically (e.g., daily
              cron) to prevent the job table from growing indefinitely.
            </li>
            <li>
              Run <strong>cleanupOldJobEvents</strong> separately since events
              accumulate faster than jobs.
            </li>
            <li>
              Run <strong>reclaimStuckJobs</strong> frequently (e.g., every few
              minutes) to recover from worker crashes or deployments.
            </li>
            <li>
              In production, use cron endpoints (see{' '}
              <code className="bg-muted px-0.5 rounded">/api/cron/</code>) to
              automate these operations.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
