import { getJobQueue } from '@/lib/queue';
import { JobTable, StatusBadge } from './job-table';
import type { JobRecord } from '@nicnocquee/dataqueue';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type AnyJobRecord = JobRecord<Record<string, unknown>, string>;

type JobMonitorColumn = {
  header: string;
  key: keyof AnyJobRecord;
  render?: (value: unknown, job: AnyJobRecord) => React.ReactNode;
};

const statuses = [
  'pending',
  'processing',
  'waiting',
  'failed',
  'completed',
  'cancelled',
] as const;

const defaultColumns: JobMonitorColumn[] = [
  { header: 'ID', key: 'id' },
  { header: 'Type', key: 'jobType' },
  { header: 'Status', key: 'status' },
  { header: 'Priority', key: 'priority' },
  { header: 'Tags', key: 'tags' },
  { header: 'Created', key: 'createdAt' },
];

const dependencyExtraColumns: JobMonitorColumn[] = [
  {
    header: 'Dep. job IDs',
    key: 'dependsOnJobIds',
    render: (value: unknown) => {
      const ids = value as number[] | null | undefined;
      if (!ids?.length) return <span className="text-muted-foreground">-</span>;
      return <span className="font-mono text-xs">{ids.join(', ')}</span>;
    },
  },
  {
    header: 'Dep. tags',
    key: 'dependsOnTags',
    render: (value: unknown) => {
      const tags = value as string[] | null | undefined;
      if (!tags?.length)
        return <span className="text-muted-foreground">-</span>;
      return (
        <span className="text-xs text-muted-foreground">{tags.join(', ')}</span>
      );
    },
  },
];

export async function JobMonitor({
  title = 'Job Monitor',
  description,
  filter,
  compact = false,
  showDependencyColumns = false,
}: {
  title?: string;
  description?: string;
  filter?: { jobType?: string; status?: string };
  compact?: boolean;
  /** When true, adds columns for persisted `dependsOnJobIds` / `dependsOnTags`. */
  showDependencyColumns?: boolean;
}) {
  const tableColumns = showDependencyColumns
    ? [
        ...defaultColumns.slice(0, 5),
        ...dependencyExtraColumns,
        defaultColumns[5],
      ]
    : defaultColumns;
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
                    columns={tableColumns}
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
