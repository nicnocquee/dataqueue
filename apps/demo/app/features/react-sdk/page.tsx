export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobTrackerDemo } from './job-tracker-demo';

export default function ReactSdkPage() {
  return (
    <FeaturePage
      title="React SDK"
      description="Track job status and progress in real time with the @nicnocquee/dataqueue-react SDK. This page demonstrates the useJob hook and DataqueueProvider for polling-based job monitoring with lifecycle callbacks."
    >
      <JobTrackerDemo />
    </FeaturePage>
  );
}
