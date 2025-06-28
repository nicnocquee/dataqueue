import { initJobQueue } from 'pg-bg-job-queue';

// Define the job payload map for this app.
// This will ensure that the job payload is typed correctly when adding jobs.
// The keys are the job types, and the values are the payload types.
export type JobPayloadMap = {
  send_email: {
    to: string;
    subject: string;
    body: string;
  };
  generate_report: {
    reportId: string;
    userId: string;
  };
};

let jobQueuePromise: ReturnType<typeof initJobQueue<JobPayloadMap>> | null =
  null;

export const getJobQueue = async () => {
  if (!jobQueuePromise) {
    jobQueuePromise = initJobQueue<JobPayloadMap>({
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
