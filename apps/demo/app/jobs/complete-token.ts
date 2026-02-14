'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const completeToken = async (
  tokenId: string,
  data?: Record<string, unknown>,
) => {
  const jobQueue = getJobQueue();
  await jobQueue.completeToken(tokenId, data);
  revalidatePath('/');
  return { success: true };
};
