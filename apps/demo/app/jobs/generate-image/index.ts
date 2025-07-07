'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const generateImage = async ({ prompt }: { prompt: string }) => {
  // Add a generate image job
  const jobQueue = getJobQueue();
  const delay = Math.floor(1000 + Math.random() * 2000); // 1000 to 3000 ms
  const runAt = new Date(Date.now() + delay); // Run between 1 and 3 seconds from now
  const job = await jobQueue.addJob({
    jobType: 'generate_image',
    payload: {
      prompt,
    },
    priority: 5, // Higher number = higher priority
    runAt: runAt,
    timeoutMs: 5000, // 5 second timeout
  });

  revalidatePath('/');

  return { job };
};
