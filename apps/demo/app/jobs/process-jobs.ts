'use server';

import { registerJobHandlers } from '@/lib/job-handler';
import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const processJobs = async () => {
  const jobQueue = await getJobQueue();

  await registerJobHandlers();

  const processor = jobQueue.createProcessor({
    workerId: `cron-${Date.now()}`,
    batchSize: 20,
    pollInterval: 2000,
    verbose: true,
  });

  processor.start();

  // Clean up old jobs (keep for 30 days)
  const deleted = await jobQueue.cleanupOldJobs(30);
  console.log(`Deleted ${deleted} old jobs`);

  revalidatePath('/');
  return { deleted };
};
