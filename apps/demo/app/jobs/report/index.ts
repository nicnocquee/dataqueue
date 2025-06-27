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
  const job = await jobQueue.addJob({
    job_type: 'generate_report',
    payload: {
      reportId,
      userId,
    },
    priority: 5, // Higher number = higher priority
    run_at: new Date(Date.now() + 60 * 1000), // Run 1 minute from now
  });

  revalidatePath('/');

  return { job };
};
