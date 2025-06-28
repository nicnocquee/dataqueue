import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getJobQueue } from '@/lib/queue';
import { JobRecord } from 'pg-bg-job-queue';
import { formatTimeDistance } from '@/lib/utils';
import Link from 'next/link';

export const PendingJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('pending');
  return <JobTable jobs={jobs} />;
};

export const ProcessingJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('processing');
  return <JobTable jobs={jobs} />;
};

export const CompletedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('completed');
  return <JobTable jobs={jobs} />;
};

export const FailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const noRetryJobs = jobs.filter((job) => job.attempts === job.max_attempts);
  return <JobTable jobs={noRetryJobs} />;
};

export const CancelledJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('cancelled');
  return <JobTable jobs={jobs} />;
};

export const WillRetryFailedJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('failed');
  const jobsToRetry = jobs.filter((job) => job.attempts < job.max_attempts);
  return <JobTable jobs={jobsToRetry} />;
};

const JobTable = ({ jobs }: { jobs: JobRecord<unknown>[] }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Run At</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Next Retry At</TableHead>
          <TableHead>Payload</TableHead>
          <TableHead>Created At</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Link
                className="underline text-primary hover:text-primary"
                href={`/job/${job.id}`}
              >
                {job.id}
              </Link>
            </TableCell>
            <TableCell>{job.job_type}</TableCell>
            <TableCell>{job.priority ? job.priority : 'default'}</TableCell>
            <TableCell>
              {job.run_at ? formatTimeDistance(job.run_at) : '-'}
            </TableCell>
            <TableCell>{job.attempts}</TableCell>
            <TableCell>
              {job.next_attempt_at
                ? formatTimeDistance(job.next_attempt_at)
                : '-'}
            </TableCell>
            <TableCell>{JSON.stringify(job.payload)}</TableCell>
            <TableCell>{job.created_at.toISOString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
