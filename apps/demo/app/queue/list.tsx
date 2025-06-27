import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getJobQueue } from '@/lib/queue';

export const PendingJobs = async () => {
  const jobQueue = await getJobQueue();
  const jobs = await jobQueue.getJobsByStatus('pending');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Payload</TableHead>
          <TableHead>Run At</TableHead>
          <TableHead>Created At</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>{job.id}</TableCell>
            <TableCell>{job.job_type}</TableCell>
            <TableCell>{JSON.stringify(job.payload)}</TableCell>
            <TableCell>{job.run_at.toISOString()}</TableCell>
            <TableCell>{job.created_at.toISOString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
