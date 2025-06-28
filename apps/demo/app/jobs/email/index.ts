'use server';

import { getJobQueue } from '@/lib/queue';
import { revalidatePath } from 'next/cache';

export const sendEmail = async ({
  name,
  email,
}: {
  name: string;
  email: string;
}) => {
  // Add a welcome email job
  const jobQueue = await getJobQueue();
  try {
    const delay = Math.floor(1000 + Math.random() * 9000); // 1000 to 9999 ms
    const runAt = new Date(Date.now() + delay); // Run between 1 and 10 seconds from now
    const job = await jobQueue.addJob({
      job_type: 'send_email',
      payload: {
        to: email,
        subject: 'Welcome to our platform!',
        body: `Hi ${name}, welcome to our platform!`,
      },
      priority: 10, // Higher number = higher priority
      run_at: runAt,
    });

    revalidatePath('/');
    return { job };
  } catch (error) {
    console.error('Error adding job:', error);
    throw error;
  }
};
