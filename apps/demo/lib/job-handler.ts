import { sendEmail } from './services/email';
import { generateReport } from './services/generate-report';
import { getJobQueue, type JobPayloadMap } from './queue';

// Object literal mapping for static enforcement
export const jobHandlers: {
  [K in keyof JobPayloadMap]: (payload: JobPayloadMap[K]) => Promise<void>;
} = {
  send_email: async (payload) => {
    const { to, subject, body } = payload;
    await sendEmail(to, subject, body);
  },
  generate_report: async (payload) => {
    const { reportId, userId } = payload;
    await generateReport(reportId, userId);
  },
};

export const registerAllJobHandlers = async (): Promise<void> => {
  const jobQueue = await getJobQueue();
  jobQueue.registerJobHandlers(jobHandlers);
};
