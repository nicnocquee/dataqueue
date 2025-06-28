'use server';

import { getJobQueue } from '@/lib/queue';
import { createUser } from '@/lib/services/user';
import { revalidatePath } from 'next/cache';

export const generateReport = async ({
  name,
  email,
  reportId,
}: {
  name: string;
  email: string;
  reportId: string;
}) => {
  const userId = await createUser(name, email);

  // Add a welcome email job
  const jobQueue = await getJobQueue();
  const delay = Math.floor(1000 + Math.random() * 9000); // 1000 to 9999 ms
  const runAt = new Date(Date.now() + delay); // Run between 1 and 10 seconds from now
  const job = await jobQueue.addJob({
    job_type: 'generate_report',
    payload: {
      reportId,
      userId,
    },
    priority: 5, // Higher number = higher priority
    run_at: runAt,
  });

  revalidatePath('/');

  return { job };
};
