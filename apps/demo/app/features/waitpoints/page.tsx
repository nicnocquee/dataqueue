export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { WaitpointDemo } from './waitpoint-demo';
import { getJobQueue } from '@/lib/queue';
import { TokenList } from './token-list';

export default async function WaitpointsPage() {
  const jobQueue = getJobQueue();
  const waitingJobs = await jobQueue.getJobsByStatus('waiting', 20);

  return (
    <FeaturePage
      title="Waitpoints & Tokens"
      description="Jobs can pause execution using ctx.waitFor() (time-based), ctx.waitUntil() (date-based), or ctx.waitForToken() (human-in-the-loop). Tokens are external signals that must be completed to resume the job. PostgreSQL only."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <div className="space-y-6">
        <WaitpointDemo />
        <TokenList waitingJobs={JSON.parse(JSON.stringify(waitingJobs))} />
        <JobMonitor title="Waiting & Pipeline Jobs" compact />
      </div>
    </FeaturePage>
  );
}
