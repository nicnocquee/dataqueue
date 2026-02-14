'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const cancelSingleJob = async (jobId: number) => {
  const jobQueue = getJobQueue();
  await jobQueue.cancelJob(jobId);
  revalidatePath('/');
  return { success: true };
};
