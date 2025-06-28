import Buttons from './buttons';
import {
  CancelledJobs,
  CompletedJobs,
  FailedJobs,
  PendingJobs,
  ProcessingJobs,
  WillRetryFailedJobs,
} from './queue/list';
import { refresh } from './queue/refresh';
import { RefreshPeriodically } from './refresh-periodically';

export default function Home() {
  return (
    <div className="flex flex-col gap-2 p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Demo</h1>
        <p className="text-lg">
          This is a demo of the job queue. When run via <code>pnpm dev</code>{' '}
          from the root, the <code>api/cron/process</code> endpoint will be
          called every 10 seconds.
        </p>
        <RefreshPeriodically key="refresh" action={refresh} interval={10000} />
      </div>
      <Buttons />
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-lg font-bold">Pending Jobs</p>
          <PendingJobs />
        </div>
        <div>
          <p className="text-lg font-bold">Processing Jobs</p>
          <ProcessingJobs />
        </div>
        <div>
          <p className="text-lg font-bold">Will Retry Failed Jobs</p>
          <WillRetryFailedJobs />
        </div>
        <div>
          <p className="text-lg font-bold">Failed Jobs</p>
          <FailedJobs />
        </div>
        <div>
          <p className="text-lg font-bold">Cancelled Jobs</p>
          <CancelledJobs />
        </div>
        <div>
          <p className="text-lg font-bold">Completed Jobs</p>
          <CompletedJobs />
        </div>
      </div>
    </div>
  );
}
