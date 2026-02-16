import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { TagDemo } from './tag-demo';

export default function TagsPage() {
  return (
    <FeaturePage
      title="Tags & Filtering"
      description="Jobs can be tagged with string arrays for grouping and filtering. Query jobs by tags using different modes: exact (tags match exactly), all (job has all specified tags), any (job has at least one), or none (job has none of the specified tags)."
      docsLinks={[
        { label: 'Get Jobs', url: 'https://docs.dataqueue.dev/usage/get-jobs' },
      ]}
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <TagDemo />
    </FeaturePage>
  );
}
