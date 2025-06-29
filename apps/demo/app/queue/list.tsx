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
        Type: 'jobType',
        Started: 'startedAt',
        Retried: 'lastRetriedAt',
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
        Type: 'jobType',
        Completed: 'completedAt',
        Attempts: 'attempts',
        Payload: 'payload',
        Created: 'createdAt',
      }}
    />
  );
};

export const FailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const noRetryJobs = jobs.filter((job) => job.attempts === job.maxAttempts);
  return (
    <JobTable
      jobs={noRetryJobs}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'jobType',
        Failed: 'lastFailedAt',
        Reason: 'failureReason',
        'Error History': 'errorHistory',
        Payload: 'payload',
        Created: 'createdAt',
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
        Type: 'jobType',
        Cancelled: 'lastCancelledAt',
        Payload: 'payload',
        Created: 'createdAt',
      }}
    />
  );
};

export const WillRetryFailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const jobsToRetry = jobs.filter((job) => job.attempts < job.maxAttempts);
  return (
    <JobTable
      jobs={jobsToRetry}
      columnJobKeyMap={{
        ID: 'id',
        Type: 'jobType',
        Failed: 'updatedAt',
        Reason: 'failureReason',
        Attempts: 'attempts',
        'Next Retry At': 'nextAttemptAt',
        Payload: 'payload',
        Created: 'createdAt',
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
              if (jobKey === 'errorHistory') {
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
    Type: 'jobType',
    Priority: 'priority',
    'Scheduled At': 'runAt',
    Attempts: 'attempts',
    'Next Retry At': 'nextAttemptAt',
    Payload: 'payload',
    'Timeout (ms)': 'timeoutMs',
    'Failure Reason': 'failureReason',
    'Pending Reason': 'pendingReason',
    'Error History': 'errorHistory',
    Created: 'createdAt',
  };
  return <JobTable jobs={jobs} columnJobKeyMap={columnJobKeyMap} />;
};
