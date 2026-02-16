import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { IdempotencyDemo } from './idempotency-demo';

export default function IdempotencyPage() {
  return (
    <FeaturePage
      title="Idempotency Keys"
      description="Prevent duplicate job creation by providing an idempotency key. If a job with the same key already exists (regardless of status), the addJob call will return the existing job ID instead of creating a new one."
      docsLinks={[
        { label: 'Add Job', url: 'https://docs.dataqueue.dev/usage/add-job' },
      ]}
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <IdempotencyDemo />
    </FeaturePage>
  );
}
