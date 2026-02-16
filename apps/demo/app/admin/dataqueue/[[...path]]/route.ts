import { createDataqueueDashboard } from '@nicnocquee/dataqueue-dashboard/next';
import { getJobQueue, jobHandlers } from '@/lib/queue';

const { GET, POST } = createDataqueueDashboard({
  jobQueue: getJobQueue(),
  jobHandlers,
  basePath: '/admin/dataqueue',
});

export { GET, POST };
