import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { CronDemo } from './cron-demo';

export default function CronPage() {
  return (
    <FeaturePage
      title="Cron Schedules"
      description="Define recurring jobs with cron expressions. The processor automatically enqueues due cron jobs before each batch — no extra code needed. Overlap protection prevents duplicate runs by default."
      docsLinks={[
        {
          label: 'Cron Jobs',
          url: 'https://docs.dataqueue.dev/usage/cron-jobs',
        },
      ]}
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <CronDemo />
    </FeaturePage>
  );
}
