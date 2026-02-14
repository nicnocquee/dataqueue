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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addGenericJob } from '@/app/jobs/add-job';
import { getJobsByTagsAction } from '@/app/jobs/get-filtered';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

export function TagDemo() {
  const [isPending, startTransition] = useTransition();

  // Add tagged job state
  const [addTags, setAddTags] = useState('urgent, finance');
  const [addResult, setAddResult] = useState<string | null>(null);

  // Query state
  const [queryTags, setQueryTags] = useState('urgent');
  const [queryMode, setQueryMode] = useState<string>('all');
  const [queryResults, setQueryResults] = useState<
    { id: number; jobType: string; tags: string[]; status: string }[] | null
  >(null);

  const handleAddTaggedJob = () => {
    startTransition(async () => {
      const tags = addTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await addGenericJob({
        jobType: 'send_email',
        payload: {
          to: `tagged-${Date.now()}@example.com`,
          subject: 'Tagged job',
          body: 'This job has tags!',
        },
        tags,
      });
      setAddResult(
        `Job created with ID: ${res.job}, tags: [${tags.join(', ')}]`,
      );
    });
  };

  const handleQuery = () => {
    startTransition(async () => {
      const tags = queryTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const jobs = await getJobsByTagsAction(
        tags,
        queryMode as 'exact' | 'all' | 'any' | 'none',
      );
      setQueryResults(
        jobs.map((j) => ({
          id: j.id,
          jobType: j.jobType,
          tags: (j.tags as string[]) ?? [],
          status: j.status,
        })),
      );
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a Tagged Job</CardTitle>
          <CardDescription>
            Create a job with tags. Tags are string arrays attached to the job
            for grouping and batch operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addTags">Tags (comma-separated)</Label>
            <Input
              id="addTags"
              value={addTags}
              onChange={(e) => setAddTags(e.target.value)}
              placeholder="urgent, finance, report"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddTaggedJob} disabled={isPending} size="sm">
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Add Tagged Job
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await addGenericJob({
                    jobType: 'generate_report',
                    payload: { reportId: `rpt-${Date.now()}`, userId: '456' },
                    tags: ['finance', 'quarterly'],
                  });
                  setAddResult(
                    'Added report job with tags: [finance, quarterly]',
                  );
                })
              }
            >
              Add &quot;finance, quarterly&quot; Job
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await addGenericJob({
                    jobType: 'send_email',
                    payload: {
                      to: 'admin@example.com',
                      subject: 'Alert',
                      body: 'Urgent!',
                    },
                    tags: ['urgent', 'alert'],
                  });
                  setAddResult('Added email job with tags: [urgent, alert]');
                })
              }
            >
              Add &quot;urgent, alert&quot; Job
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await processJobs();
                })
              }
            >
              Process Now
            </Button>
          </div>
          {addResult && (
            <p className="text-sm text-muted-foreground">{addResult}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Query Jobs by Tags</CardTitle>
          <CardDescription>
            Search for jobs using tags with different matching modes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="queryTags">Tags to search</Label>
              <Input
                id="queryTags"
                value={queryTags}
                onChange={(e) => setQueryTags(e.target.value)}
                placeholder="urgent, finance"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="queryMode">Tag Query Mode</Label>
              <Select value={queryMode} onValueChange={setQueryMode}>
                <SelectTrigger id="queryMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    all - job has ALL specified tags
                  </SelectItem>
                  <SelectItem value="any">
                    any - job has at least ONE tag
                  </SelectItem>
                  <SelectItem value="exact">
                    exact - tags match exactly
                  </SelectItem>
                  <SelectItem value="none">
                    none - job has NONE of the tags
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleQuery} disabled={isPending} size="sm">
            {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Search
          </Button>

          {queryResults !== null && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Found {queryResults.length} job(s)
              </p>
              {queryResults.length > 0 ? (
                <div className="border rounded-md divide-y">
                  {queryResults.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono">#{job.id}</span>
                        <span className="text-muted-foreground">
                          {job.jobType}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {job.status}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        {job.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No jobs match the query.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
