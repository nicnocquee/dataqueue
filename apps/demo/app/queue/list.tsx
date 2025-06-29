import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getJobQueue } from '@/lib/queue';
import { JobRecord } from '../../../../packages/dataqueue/dist';
import { formatTimeDistance } from '@/lib/utils';
import Link from 'next/link';

export const PendingJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('pending');
  return <DefaultJobTable jobs={jobs} />;
};

export const ProcessingJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('processing');
  return (
    <JobTable
      jobs={jobs}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'job_type',
        Started: 'started_at',
        Retried: 'last_retried_at',
        Payload: 'payload',
      }}
    />
  );
};

export const CompletedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('completed');
  return (
    <JobTable
      jobs={jobs}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'job_type',
        Completed: 'completed_at',
        Attempts: 'attempts',
        Payload: 'payload',
        Created: 'created_at',
      }}
    />
  );
};

export const FailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const noRetryJobs = jobs.filter((job) => job.attempts === job.max_attempts);
  return (
    <JobTable
      jobs={noRetryJobs}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'job_type',
        Failed: 'last_failed_at',
        Reason: 'failure_reason',
        'Error History': 'error_history',
        Payload: 'payload',
        Created: 'created_at',
      }}
    />
  );
};

export const CancelledJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('cancelled');
  return (
    <JobTable
      jobs={jobs}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'job_type',
        Cancelled: 'last_cancelled_at',
        Payload: 'payload',
        Created: 'created_at',
      }}
    />
  );
};

export const WillRetryFailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const jobsToRetry = jobs.filter((job) => job.attempts < job.max_attempts);
  return (
    <JobTable
      jobs={jobsToRetry}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'job_type',
        Failed: 'updated_at',
        Reason: 'failure_reason',
        Attempts: 'attempts',
        'Next Retry At': 'next_attempt_at',
        Payload: 'payload',
        Created: 'created_at',
      }}
    />
  );
};

type ColumnJobKeyMap = Record<string, keyof JobRecord<unknown, never>>;

const JobTable = ({
  jobs,
  columnJobKeyMap,
}: {
  jobs: JobRecord<Record<string, unknown>, string>[];
  columnJobKeyMap: ColumnJobKeyMap;
}) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {Object.entries(columnJobKeyMap).map(([column]) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            {Object.entries(columnJobKeyMap).map(([column, jobKey]) => {
              const value = job[jobKey] as string | number | Date | null;
              if (jobKey === 'error_history') {
                const errorHistory = value as
                  | {
                      message: string;
                      timestamp: string;
                    }[]
                  | null;
                return (
                  <TableCell key={column}>
                    <ul>
                      {errorHistory?.map((error) => (
                        <li key={error.message + error.timestamp}>
                          {error.timestamp} - {error.message}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                );
              } else if (jobKey === 'id') {
                return (
                  <TableCell key={column}>
                    <Link
                      className="underline text-primary"
                      href={`/job/${value as string | number}`}
                    >
                      {value as string | number}
                    </Link>
                  </TableCell>
                );
              } else if (jobKey === 'payload') {
                return (
                  <TableCell key={column}>{JSON.stringify(value)}</TableCell>
                );
              } else if (value instanceof Date) {
                return (
                  <TableCell key={column}>
                    {formatTimeDistance(value)}
                  </TableCell>
                );
              }
              return <TableCell key={column}>{value as string}</TableCell>;
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const DefaultJobTable = ({
  jobs,
}: {
  jobs: JobRecord<Record<string, unknown>, string>[];
}) => {
  const columnJobKeyMap: ColumnJobKeyMap = {
    ID: 'id',
    Type: 'job_type',
    Priority: 'priority',
    'Scheduled At': 'run_at',
    Attempts: 'attempts',
    'Next Retry At': 'next_attempt_at',
    Payload: 'payload',
    'Timeout (ms)': 'timeout_ms',
    'Failure Reason': 'failure_reason',
    'Pending Reason': 'pending_reason',
    'Error History': 'error_history',
    Created: 'created_at',
  };
  return <JobTable jobs={jobs} columnJobKeyMap={columnJobKeyMap} />;
};
