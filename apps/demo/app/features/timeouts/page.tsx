export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { TimeoutDemo } from './timeout-demo';

export default function TimeoutsPage() {
  return (
    <FeaturePage
      title="Timeout Handling"
      description="Control job execution time with timeoutMs. Use ctx.prolong() for heartbeat-style extensions, ctx.onTimeout() to react before abort, and forceKillOnTimeout for hard termination via Worker Threads."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <div className="space-y-6">
        <TimeoutDemo />
        <JobMonitor
          title="Image Jobs"
          description="Showing generate_image jobs to observe timeout behavior"
          filter={{ jobType: 'generate_image' }}
          compact
        />
      </div>
    </FeaturePage>
  );
}
