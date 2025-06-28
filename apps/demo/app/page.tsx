import Buttons from './buttons';
import { ProcessJobsPeriodically } from './process-jobs-periodically';
import { CompletedJobs, PendingJobs, ProcessingJobs } from './queue/list';
import { refresh } from './queue/refresh';
import { RefreshPeriodically } from './refresh-periodically';

export default function Home() {
  return (
    <div className="flex flex-col gap-2 p-4 space-y-4">
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
          <p className="text-lg font-bold">Completed Jobs</p>
          <CompletedJobs />
        </div>
      </div>
      <RefreshPeriodically key="refresh" action={refresh} interval={10000} />
      <ProcessJobsPeriodically interval={12000} />
    </div>
  );
}
