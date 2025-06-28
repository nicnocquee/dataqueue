import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getJobQueue } from '@/lib/queue';
import { notFound } from 'next/navigation';

const JobPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!id) {
    notFound();
  }
  const jobQueue = await getJobQueue();
  const job = await jobQueue.getJob(Number(id));
  if (!job) {
    notFound();
  }
  return (
    <div className="p-4">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Property</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(job).map(([key, value]) => (
            <TableRow key={key}>
              <TableCell>{key}</TableCell>
              <TableCell>{JSON.stringify(value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default JobPage;
