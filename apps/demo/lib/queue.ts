import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';
import { sendEmail } from './services/email';
import { generateReport } from './services/generate-report';
import { generateImageAi } from './services/generate-image-ai';

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
  generate_image: {
    prompt: string;
  };
};

let jobQueuePromise: ReturnType<typeof initJobQueue<JobPayloadMap>> | null =
  null;

export const getJobQueue = async () => {
  if (!jobQueuePromise) {
    jobQueuePromise = initJobQueue<JobPayloadMap>({
      databaseConfig: {
        connectionString: process.env.PG_DATAQUEUE_DATABASE, // Set this in your environment
      },
      verbose: process.env.NODE_ENV === 'development',
    });
  }
  return jobQueuePromise;
};

// Object literal mapping for static enforcement
export const jobHandlers: JobHandlers<JobPayloadMap> = {
  send_email: async (payload) => {
    const { to, subject, body } = payload;
    await sendEmail(to, subject, body);
  },
  generate_report: async (payload) => {
    const { reportId, userId } = payload;
    await generateReport(reportId, userId);
  },
  generate_image: async (payload, signal) => {
    const { prompt } = payload;
    await generateImageAi(prompt, signal);
  },
};
