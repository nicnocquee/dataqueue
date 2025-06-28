'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const cancelPendingJobs = async () => {
  const jobQueue = await getJobQueue();
  await jobQueue.cancelAllUpcomingJobs();

  revalidatePath('/');
  return { message: 'Pending jobs cancelled' };
};
