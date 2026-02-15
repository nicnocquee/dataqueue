'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const cleanupOldJobEvents = async (daysToKeep: number = 30) => {
  const jobQueue = getJobQueue();
  const deleted = await jobQueue.cleanupOldJobEvents(daysToKeep);
  revalidatePath('/');
  return { deleted };
};

export const cleanupOldJobs = async (daysToKeep: number = 30) => {
  const jobQueue = getJobQueue();
  const deleted = await jobQueue.cleanupOldJobs(daysToKeep);
  revalidatePath('/');
  return { deleted };
};
