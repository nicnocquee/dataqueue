import { getJobQueue } from './queue';
import { sendEmail } from './services/email';
import { generateReport } from './services/generate-report';

export const registerJobHandlers = async (): Promise<void> => {
  const jobQueue = await getJobQueue();

  // Register handler for sending emails
  jobQueue.registerJobHandler('send_email', async (payload) => {
    const { to, subject, body } = payload;
    await sendEmail(to, subject, body);
  });

  // Register handler for generating reports
  jobQueue.registerJobHandler('generate_report', async (payload) => {
    const { reportId, userId } = payload;
    await generateReport(reportId, userId);
  });
};
