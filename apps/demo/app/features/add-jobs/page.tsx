export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { AddJobForm } from './add-job-form';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';

export default function AddJobsPage() {
  return (
    <FeaturePage
      title="Add & Process Jobs"
      description="Create jobs with full control over type, payload, priority, tags, idempotency keys, scheduling, timeout, and force kill options. Then trigger processing to see them execute."
      docsLinks={[
        { label: 'Add Job', url: 'https://docs.dataqueue.dev/usage/add-job' },
        {
          label: 'Process Jobs',
          url: 'https://docs.dataqueue.dev/usage/process-jobs',
        },
      ]}
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <div className="space-y-6">
        <AddJobForm />
        <JobMonitor title="Recent Jobs" compact />
      </div>
    </FeaturePage>
  );
}
