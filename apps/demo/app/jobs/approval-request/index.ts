'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const addApprovalRequest = async ({
  requestType,
  description,
  tags,
  priority,
}: {
  requestType: string;
  description: string;
  tags?: string[];
  priority?: number;
}) => {
  const jobQueue = getJobQueue();
  const job = await jobQueue.addJob({
    jobType: 'approval_request',
    payload: { requestType, description },
    priority: priority ?? 5,
    tags: [...(tags ?? []), 'approval'],
  });
  revalidatePath('/');
  return { job };
};
