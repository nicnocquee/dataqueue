'use server';

import { getJobQueue, jobHandlers } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const processJobs = async () => {
  const jobQueue = await getJobQueue();

  const processor = jobQueue.createProcessor(jobHandlers, {
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

  const processor = jobQueue.createProcessor(jobHandlers, {
    workerId: `cron-${Date.now()}`,
    batchSize: 3,
    verbose: true,
    jobType,
  });

  await processor.start();

  revalidatePath('/');
  return { jobType };
};
