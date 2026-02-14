import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { EventsDemo } from './events-demo';

export default function EventsPage() {
  return (
    <FeaturePage
      title="Job Events"
      description="Every job state transition is recorded as an event: added, processing, completed, failed, cancelled, retried, edited, prolonged, waiting. Use getJobEvents(jobId) to retrieve the full event history for any job."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <EventsDemo />
    </FeaturePage>
  );
}
