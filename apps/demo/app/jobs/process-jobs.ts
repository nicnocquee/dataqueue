'use server';

import { registerJobHandlers } from '@/lib/job-handler';
import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const processJobs = async () => {
  const jobQueue = await getJobQueue();

  await registerJobHandlers();

  const processor = jobQueue.createProcessor({
    workerId: `cron-${Date.now()}`,
    batchSize: 3,
    verbose: true,
  });

  await processor.start();

  // Clean up old jobs (keep for 30 days)
  const deleted = await jobQueue.cleanupOldJobs(30);

  revalidatePath('/');
  return { deleted };
};

export const processJobsByType = async (jobType: string) => {
  const jobQueue = await getJobQueue();

  await registerJobHandlers();

  const processor = jobQueue.createProcessor({
    workerId: `cron-${Date.now()}`,
    batchSize: 3,
    verbose: true,
    jobType,
  });

  await processor.start();

  revalidatePath('/');
  return { jobType };
};
