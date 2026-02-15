export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { StepDemo } from './step-demo';

export default function StepsPage() {
  return (
    <FeaturePage
      title="Step Memoization"
      description="Use ctx.run(stepName, fn) to define named, memoized steps within a job handler. If the job is retried, previously completed steps are skipped and their return values are replayed from storage. This enables durable, resumable multi-step workflows."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <div className="space-y-6">
        <StepDemo />
        <JobMonitor
          title="Pipeline Jobs"
          filter={{ jobType: 'data_pipeline' }}
          compact
        />
      </div>
    </FeaturePage>
  );
}
