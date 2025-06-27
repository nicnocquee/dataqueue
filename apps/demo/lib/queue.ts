import { initJobQueue, JobQueue } from 'pg-bg-job-queue';

let jobQueuePromise: Promise<JobQueue> | null = null;

export const getJobQueue = async (): Promise<JobQueue> => {
  if (!jobQueuePromise) {
    jobQueuePromise = initJobQueue({
      databaseConfig: {
        connectionString: process.env.DATABASE_URL, // Set this in your environment
        ssl:
          process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : undefined,
      },
      verbose: process.env.NODE_ENV === 'development',
    });
  }
  return jobQueuePromise;
};
