import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';
import { sendEmail } from './services/email';
import { generateReport } from './services/generate-report';
import { generateImageAi } from './services/generate-image-ai';
import { fetchData, transformData, loadData } from './services/data-pipeline';

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
  data_pipeline: {
    source: string;
    destination: string;
  };
  approval_request: {
    requestType: string;
    description: string;
  };
};

let jobQueue: ReturnType<typeof initJobQueue<JobPayloadMap>> | null = null;

export const getJobQueue = () => {
  if (!jobQueue) {
    jobQueue = initJobQueue<JobPayloadMap>({
      databaseConfig: {
        connectionString: process.env.PG_DATAQUEUE_DATABASE, // Set this in your environment
      },
      verbose: process.env.NODE_ENV === 'development',
    });
  }
  return jobQueue;
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
  // Updated: demonstrates ctx.onTimeout and ctx.prolong
  generate_image: async (payload, signal, ctx) => {
    const { prompt } = payload;
    // Register an onTimeout callback that returns ms to extend the deadline
    ctx.onTimeout(() => {
      console.log('[generate_image] Timeout approaching, extending by 5s...');
      return 5000; // return ms to extend
    });
    // Heartbeat: prolong timeout by 3s periodically
    ctx.prolong(3000);
    await generateImageAi(prompt, signal);
  },
  // New: demonstrates ctx.run (step memoization) + ctx.waitFor
  data_pipeline: async (payload, _signal, ctx) => {
    const { source, destination } = payload;
    // Step 1: Fetch data (memoized - won't re-run on retry)
    const fetched = await ctx.run('fetch-data', async () => {
      return await fetchData(source);
    });
    // Wait 5 seconds between steps
    await ctx.waitFor({ seconds: 5 });
    // Step 2: Transform data (memoized)
    const transformed = await ctx.run('transform-data', async () => {
      return await transformData(fetched);
    });
    // Wait 5 seconds between steps
    await ctx.waitFor({ seconds: 5 });
    // Step 3: Load data (memoized)
    await ctx.run('load-data', async () => {
      await loadData(transformed, destination);
    });
  },
  // New: demonstrates createToken + waitForToken (human-in-the-loop)
  approval_request: async (payload, _signal, ctx) => {
    const { requestType, description } = payload;
    console.log(
      `[approval_request] Waiting for approval: ${requestType} - ${description}`,
    );
    // Create a token that expires in 1 hour
    const token = await ctx.createToken({
      timeout: '1h',
      tags: ['approval', requestType],
    });
    console.log(`[approval_request] Token created: ${token.id}`);
    // Job will pause here until the token is completed
    const result = await ctx.waitForToken(token.id);
    if (result.ok) {
      console.log(
        `[approval_request] Token completed with output:`,
        result.output,
      );
    } else {
      console.log(`[approval_request] Token failed:`, result.error);
    }
  },
};
