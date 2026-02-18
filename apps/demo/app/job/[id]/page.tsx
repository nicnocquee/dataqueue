import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getJobQueue } from '@/lib/queue';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge } from '@/components/job-table';
import { JobDetailActions } from './job-detail-actions';

const JobPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!id) {
    notFound();
  }
  const jobQueue = getJobQueue();
  const job = await jobQueue.getJob(Number(id));
  if (!job) {
    notFound();
  }
  const events = await jobQueue.getJobEvents(Number(id));

  const tags = (job.tags as string[]) ?? [];
  const serializedJob = JSON.parse(JSON.stringify(job));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold">Job #{id}</h1>
        <StatusBadge status={job.status} />
      </div>

      <Separator />

      {/* Action buttons */}
      <JobDetailActions job={serializedJob} />

      {/* Job Properties */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Property</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">ID</TableCell>
                <TableCell className="font-mono">{job.id}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Job Type</TableCell>
                <TableCell>{job.jobType}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Status</TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Priority</TableCell>
                <TableCell>{job.priority}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Payload</TableCell>
                <TableCell>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {JSON.stringify(job.payload)}
                  </code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Tags</TableCell>
                <TableCell>
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
              {job.idempotencyKey && (
                <TableRow>
                  <TableCell className="font-medium">Idempotency Key</TableCell>
                  <TableCell className="font-mono text-xs">
                    {job.idempotencyKey}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="font-medium">Attempts</TableCell>
                <TableCell>
                  {job.attempts} / {job.maxAttempts}
                  {job.attempts === job.maxAttempts ? (
                    <strong>
                      {`(max attempts reached, job is permanently failed and
                      will not be retried again)`}
                    </strong>
                  ) : null}
                </TableCell>
              </TableRow>
              {job.timeoutMs && (
                <TableRow>
                  <TableCell className="font-medium">Timeout</TableCell>
                  <TableCell>{job.timeoutMs}ms</TableCell>
                </TableRow>
              )}
              {job.forceKillOnTimeout && (
                <TableRow>
                  <TableCell className="font-medium">
                    Force Kill on Timeout
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive" className="text-xs">
                      Yes
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
              {job.failureReason && (
                <TableRow>
                  <TableCell className="font-medium">Failure Reason</TableCell>
                  <TableCell className="text-destructive">
                    {job.failureReason}
                  </TableCell>
                </TableRow>
              )}
              {job.waitTokenId && (
                <TableRow>
                  <TableCell className="font-medium">Wait Token</TableCell>
                  <TableCell className="font-mono text-xs">
                    {job.waitTokenId}
                  </TableCell>
                </TableRow>
              )}
              {job.waitUntil && (
                <TableRow>
                  <TableCell className="font-medium">Wait Until</TableCell>
                  <TableCell>
                    {new Date(job.waitUntil).toLocaleString()}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="font-medium">Run At</TableCell>
                <TableCell>{new Date(job.runAt).toLocaleString()}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Created At</TableCell>
                <TableCell>
                  {new Date(job.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
              {job.startedAt && (
                <TableRow>
                  <TableCell className="font-medium">Started At</TableCell>
                  <TableCell>
                    {new Date(job.startedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              )}
              {job.completedAt && (
                <TableRow>
                  <TableCell className="font-medium">Completed At</TableCell>
                  <TableCell>
                    {new Date(job.completedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Error History */}
      {job.errorHistory && job.errorHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Error History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {job.errorHistory.map(
                (err: { message: string; timestamp: string }, i: number) => (
                  <div key={i} className="border rounded-md px-3 py-2 text-sm">
                    <p className="text-destructive">{err.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {err.timestamp}
                    </p>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Events Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Events ({events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="relative pl-6">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="relative border-l-2 border-border pl-4 pb-4 last:pb-0 ml-2"
                >
                  <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full border-2 border-background bg-primary" />
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          event.eventType === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-xs"
                      >
                        {event.eventType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {event.createdAt.toLocaleString()}
                      </span>
                    </div>
                    {event.metadata &&
                      Object.keys(event.metadata).length > 0 && (
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded mt-1 block">
                          {JSON.stringify(event.metadata)}
                        </code>
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default JobPage;
