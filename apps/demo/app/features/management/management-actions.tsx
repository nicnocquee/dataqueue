'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { retryJob } from '@/app/jobs/retry';
import { cancelSingleJob } from '@/app/jobs/cancel-job';
import { cancelPendingJobs } from '@/app/jobs/cancel';
import { editJob } from '@/app/jobs/edit-job';
import { Loader2 } from 'lucide-react';

type SerializedJob = {
  id: number;
  jobType: string;
  status: string;
  priority: number;
  tags?: string[];
  attempts: number;
  maxAttempts: number;
  failureReason?: string | null;
  runAt: string;
};

export function ManagementActions({
  pendingJobs,
  failedJobs,
  cancelledJobs,
}: {
  pendingJobs: SerializedJob[];
  failedJobs: SerializedJob[];
  cancelledJobs: SerializedJob[];
}) {
  const [isPending, startTransition] = useTransition();
  const [editingJob, setEditingJob] = useState<number | null>(null);
  const [editPriority, setEditPriority] = useState('');
  const [editTags, setEditTags] = useState('');
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Retry Failed Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Retry Failed Jobs</CardTitle>
          <CardDescription>
            Use{' '}
            <code className="text-xs bg-muted px-1 rounded">
              retryJob(jobId)
            </code>{' '}
            to re-enqueue a failed or cancelled job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {failedJobs.length === 0 && cancelledJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No failed or cancelled jobs to retry. Add some jobs and process
              them to see failures.
            </p>
          ) : (
            <div className="space-y-2">
              {[...failedJobs, ...cancelledJobs].map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between border rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">#{job.id}</span>
                    <span>{job.jobType}</span>
                    <Badge variant="destructive" className="text-xs">
                      {job.status}
                    </Badge>
                    {job.failureReason && (
                      <span className="text-muted-foreground text-xs">
                        ({job.failureReason})
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {job.attempts}/{job.maxAttempts} attempts
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await retryJob(job.id);
                        setResult(`Job #${job.id} retried`);
                      })
                    }
                  >
                    {isPending && (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    )}
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Pending Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Cancel Jobs</CardTitle>
          <CardDescription>
            Use{' '}
            <code className="text-xs bg-muted px-1 rounded">
              cancelJob(jobId)
            </code>{' '}
            to cancel a single pending job, or{' '}
            <code className="text-xs bg-muted px-1 rounded">
              cancelAllUpcomingJobs()
            </code>{' '}
            for bulk cancel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending jobs to cancel.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between border rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">#{job.id}</span>
                    <span>{job.jobType}</span>
                    <Badge variant="outline" className="text-xs">
                      priority: {job.priority}
                    </Badge>
                    {job.tags && job.tags.length > 0 && (
                      <div className="flex gap-1">
                        {job.tags.map((t) => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-xs"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await cancelSingleJob(job.id);
                        setResult(`Job #${job.id} cancelled`);
                      })
                    }
                  >
                    Cancel
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await cancelPendingJobs();
                    setResult('All pending jobs cancelled');
                  })
                }
              >
                Cancel All Pending Jobs
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Pending Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Edit Pending Jobs</CardTitle>
          <CardDescription>
            Use{' '}
            <code className="text-xs bg-muted px-1 rounded">
              editJob(jobId, updates)
            </code>{' '}
            to change priority, tags, or schedule of a pending job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending jobs to edit.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingJobs.map((job) => (
                <div key={job.id} className="border rounded-md px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">#{job.id}</span>
                      <span>{job.jobType}</span>
                      <Badge variant="outline" className="text-xs">
                        priority: {job.priority}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (editingJob === job.id) {
                          setEditingJob(null);
                        } else {
                          setEditingJob(job.id);
                          setEditPriority(String(job.priority));
                          setEditTags(job.tags?.join(', ') ?? '');
                        }
                      }}
                    >
                      {editingJob === job.id ? 'Close' : 'Edit'}
                    </Button>
                  </div>
                  {editingJob === job.id && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Priority</Label>
                        <Input
                          type="number"
                          value={editPriority}
                          onChange={(e) => setEditPriority(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          Tags (comma-separated)
                        </Label>
                        <Input
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(async () => {
                            const tags = editTags
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean);
                            await editJob(job.id, {
                              priority: editPriority
                                ? Number(editPriority)
                                : undefined,
                              tags: tags.length > 0 ? tags : null,
                            });
                            setResult(`Job #${job.id} updated`);
                            setEditingJob(null);
                          })
                        }
                      >
                        {isPending && (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        )}
                        Save Changes
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {result && <p className="text-sm text-muted-foreground">{result}</p>}
    </div>
  );
}
