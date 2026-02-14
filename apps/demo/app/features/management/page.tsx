export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { getJobQueue } from '@/lib/queue';
import { ManagementActions } from './management-actions';

export default async function ManagementPage() {
  const jobQueue = getJobQueue();
  const [pending, failed, cancelled] = await Promise.all([
    jobQueue.getJobsByStatus('pending', 20),
    jobQueue.getJobsByStatus('failed', 20),
    jobQueue.getJobsByStatus('cancelled', 20),
  ]);

  return (
    <FeaturePage
      title="Job Management"
      description="Manage individual jobs: retry failed or cancelled jobs, cancel pending jobs, and edit pending job properties (priority, tags, schedule)."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <ManagementActions
        pendingJobs={JSON.parse(JSON.stringify(pending))}
        failedJobs={JSON.parse(JSON.stringify(failed))}
        cancelledJobs={JSON.parse(JSON.stringify(cancelled))}
      />
    </FeaturePage>
  );
}
