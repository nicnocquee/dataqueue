export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { DependencyDemo } from './dependency-demo';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';

export default function DependenciesPage() {
  return (
    <FeaturePage
      title="Job dependencies"
      description="Optional dependsOn when enqueueing: wait on specific job ids (completed prerequisites) and/or tag-drain barriers. Failures and cancellations on prerequisites cascade to dependents."
      docsLinks={[
        {
          label: 'Add job',
          url: 'https://docs.dataqueue.dev/usage/add-job',
        },
      ]}
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <div className="space-y-6">
        <DependencyDemo />
        <JobMonitor
          title="Jobs from this demo"
          description="Filter: dep_demo. Dependency columns show persisted prerequisites."
          filter={{ jobType: 'dep_demo' }}
          compact
          showDependencyColumns
        />
      </div>
    </FeaturePage>
  );
}
