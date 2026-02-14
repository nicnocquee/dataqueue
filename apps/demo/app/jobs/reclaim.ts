'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const reclaimStuckJobs = async (
  maxProcessingTimeMinutes: number = 10,
) => {
  const jobQueue = getJobQueue();
  const reclaimed = await jobQueue.reclaimStuckJobs(maxProcessingTimeMinutes);
  revalidatePath('/');
  return { reclaimed };
};
