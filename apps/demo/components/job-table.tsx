import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatTimeDistance } from '@/lib/utils';
import Link from 'next/link';
import type { JobRecord } from '@nicnocquee/dataqueue';

type AnyJobRecord = JobRecord<Record<string, unknown>, string>;

export function JobTable({
  jobs,
  columns,
  actions,
  emptyMessage = 'No jobs found.',
}: {
  jobs: AnyJobRecord[];
  columns: {
    header: string;
    key: keyof AnyJobRecord;
    render?: (value: unknown, job: AnyJobRecord) => React.ReactNode;
  }[];
  actions?: (job: AnyJobRecord) => React.ReactNode;
  emptyMessage?: string;
}) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.header}>{col.header}</TableHead>
          ))}
          {actions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            {columns.map((col) => {
              const value = job[col.key];
              if (col.render) {
                return (
                  <TableCell key={col.header}>
                    {col.render(value, job)}
                  </TableCell>
                );
              }
              return (
                <TableCell key={col.header}>
                  {renderValue(col.key, value)}
                </TableCell>
              );
            })}
            {actions && <TableCell>{actions(job)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function renderValue(key: string, value: unknown) {
  if (key === 'id') {
    return (
      <Link className="underline text-primary font-mono" href={`/job/${value}`}>
        {String(value)}
      </Link>
    );
  }
  if (key === 'tags') {
    const tags = value as string[] | undefined;
    if (!tags || tags.length === 0)
      return <span className="text-muted-foreground">-</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    );
  }
  if (key === 'payload') {
    return (
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate block">
        {JSON.stringify(value)}
      </code>
    );
  }
  if (key === 'errorHistory') {
    const errors = value as { message: string; timestamp: string }[] | null;
    if (!errors || errors.length === 0)
      return <span className="text-muted-foreground">-</span>;
    return (
      <ul className="text-xs space-y-0.5">
        {errors.map((e, i) => (
          <li key={i} className="text-destructive">
            {e.message}
          </li>
        ))}
      </ul>
    );
  }
  if (key === 'status') {
    return <StatusBadge status={String(value)} />;
  }
  if (value instanceof Date) {
    return <span className="text-sm">{formatTimeDistance(value)}</span>;
  }
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span className="text-sm">{String(value)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    {
      pending: 'outline' as const,
      processing: 'default' as const,
      completed: 'secondary' as const,
      failed: 'destructive' as const,
      cancelled: 'outline' as const,
      waiting: 'secondary' as const,
    }[status] ?? ('outline' as const);

  return (
    <Badge variant={variant} className="text-xs capitalize">
      {status}
    </Badge>
  );
}
