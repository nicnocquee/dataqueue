'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const editJob = async (
  jobId: number,
  updates: {
    priority?: number;
    tags?: string[] | null;
    runAt?: Date | null;
    timeoutMs?: number | null;
    maxAttempts?: number;
  },
) => {
  const jobQueue = getJobQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await jobQueue.editJob(jobId, updates as any);
  revalidatePath('/');
  return { success: true };
};
