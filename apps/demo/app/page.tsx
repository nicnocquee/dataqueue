import Buttons from './buttons';
import { PendingJobs } from './queue/list';

export default function Home() {
  return (
    <div className="flex flex-col gap-2 p-4 space-y-4">
      <Buttons />
      <PendingJobs />
    </div>
  );
}
