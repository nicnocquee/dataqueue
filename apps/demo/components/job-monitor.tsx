import { getJobQueue } from '@/lib/queue';
import { JobTable, StatusBadge } from './job-table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const statuses = [
  'pending',
  'processing',
  'waiting',
  'failed',
  'completed',
  'cancelled',
] as const;

const defaultColumns = [
  { header: 'ID', key: 'id' as const },
  { header: 'Type', key: 'jobType' as const },
  { header: 'Status', key: 'status' as const },
  { header: 'Priority', key: 'priority' as const },
  { header: 'Tags', key: 'tags' as const },
  { header: 'Created', key: 'createdAt' as const },
];

export async function JobMonitor({
  title = 'Job Monitor',
  description,
  filter,
  compact = false,
}: {
  title?: string;
  description?: string;
  filter?: { jobType?: string; status?: string };
  compact?: boolean;
}) {
  const jobQueue = getJobQueue();

  const statusesToShow = filter?.status
    ? [filter.status]
    : (statuses as unknown as string[]);

  const jobsByStatus = await Promise.all(
    statusesToShow.map(async (status) => {
      const jobs = await jobQueue.getJobsByStatus(
        status as
          | 'pending'
          | 'processing'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | 'waiting',
        compact ? 5 : 20,
      );
      const filtered = filter?.jobType
        ? jobs.filter((j) => j.jobType === filter.jobType)
        : jobs;
      return { status, jobs: filtered };
    }),
  );

  const totalJobs = jobsByStatus.reduce((sum, s) => sum + s.jobs.length, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            {jobsByStatus.map(({ status, jobs }) => (
              <div key={status} className="flex items-center gap-1">
                <StatusBadge status={status} />
                <span className="text-xs text-muted-foreground">
                  {jobs.length}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      {totalJobs > 0 && (
        <CardContent>
          <div className="space-y-4">
            {jobsByStatus
              .filter(({ jobs }) => jobs.length > 0)
              .map(({ status, jobs }) => (
                <div key={status}>
                  <h4 className="text-sm font-medium mb-2 capitalize">
                    {status} ({jobs.length})
                  </h4>
                  <JobTable
                    jobs={jobs}
                    columns={defaultColumns}
                    emptyMessage=""
                  />
                </div>
              ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
