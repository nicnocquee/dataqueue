import { FeaturePage } from '@/components/feature-page';
import { RefreshPeriodically } from '@/app/refresh-periodically';
import { refresh } from '@/app/queue/refresh';
import { MaintenanceActions } from './maintenance-actions';

export default function MaintenancePage() {
  return (
    <FeaturePage
      title="Maintenance"
      description="Keep your queue healthy with built-in maintenance operations: clean up old completed jobs, clean up old event logs, and reclaim jobs stuck in processing state."
    >
      <RefreshPeriodically action={refresh} interval={5000} />
      <MaintenanceActions />
    </FeaturePage>
  );
}
