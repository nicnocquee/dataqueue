'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const addDataPipeline = async ({
  source,
  destination,
  tags,
  priority,
}: {
  source: string;
  destination: string;
  tags?: string[];
  priority?: number;
}) => {
  const jobQueue = getJobQueue();
  const job = await jobQueue.addJob({
    jobType: 'data_pipeline',
    payload: { source, destination },
    priority: priority ?? 5,
    tags,
  });
  revalidatePath('/');
  return { job };
};
