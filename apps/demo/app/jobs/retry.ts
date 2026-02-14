'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const retryJob = async (jobId: number) => {
  const jobQueue = getJobQueue();
  await jobQueue.retryJob(jobId);
  revalidatePath('/');
  return { success: true };
};
