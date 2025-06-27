# pg-bg-job-queue

A lightweight, PostgreSQL-backed job queue for Node.js/TypeScript projects. Schedule, process, and manage background jobs with ease—perfect for Next.js, serverless, and traditional Node.js apps.

## Features

- Simple API for adding and processing jobs
- Supports job priorities, scheduling, and retries
- Works with serverless and traditional environments
- Written in TypeScript

## Installation

```bash
npm install pg-bg-job-queue
```

## Quick Start

### 1. Initialize the Job Queue

Create a file (e.g., `lib/queue.ts`) to initialize and reuse the job queue instance:

```typescript:lib/queue.ts
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
```

### 2. Register Job Handlers

Define your job handlers (e.g., in `lib/job-handler.ts`). Handlers process jobs by type:

```typescript:lib/job-handler.ts
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
```

### 3. Add a Job (e.g., in an API Route or Server Function)

Add jobs to the queue from your application logic, for example in a server function:

```typescript:app/jobs/email.ts
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
    const runAt = new Date(Date.now() + 5 * 1000); // Run 5 seconds from now
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

```

### 4. Process Jobs (e.g., with a Cron Job)

Set up a route to process jobs in batches. This example is for a server function which can be triggered by a cron job:

```typescript:app/api/cron/route.ts
import { registerJobHandlers } from '@/lib/job-handler';
import { getJobQueue } from '@/lib/queue';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Optional: Authenticate the request (e.g., with a secret)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Initialize the job queue
    const jobQueue = await getJobQueue();

    // Register job handlers
    await registerJobHandlers();

    // Create a processor instance
    const processor = jobQueue.createProcessor({
      workerId: `cron-${Date.now()}`,
      batchSize: 20,
      verbose: true,
    });

    // Start the processor
    processor.start();

    // Clean up old jobs (keep for 30 days)
    const deleted = await jobQueue.cleanupOldJobs(30);

    return NextResponse.json({
      message: 'Job processing completed',
      cleanedUp: deleted,
    });
  } catch (error) {
    console.error('Error processing jobs:', error);
    return NextResponse.json(
      { message: 'Failed to process jobs' },
      { status: 500 },
    );
  }
}
```

#### Example: Vercel Cron Configuration

Add to your `vercel.json` to call the cron route every 5 minutes:

```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### 5. Cancel a Job

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();
    const jobQueue = await getJobQueue();
    await jobQueue.cancelJob(jobId);
    return NextResponse.json({ message: 'Job cancelled' });
  } catch (error) {
    console.error('Error cancelling job:', error);
    return NextResponse.json(
      { message: 'Failed to cancel job' },
      { status: 500 },
    );
  }
}
```

### 6. Cancel All Upcoming Jobs

Cancel all jobs that are still pending (not yet started or scheduled for the future):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

export async function POST(request: NextRequest) {
  try {
    const jobQueue = await getJobQueue();
    // Cancel all pending jobs
    const cancelledCount = await jobQueue.cancelAllUpcomingJobs();
    return NextResponse.json({ message: `Cancelled ${cancelledCount} jobs` });
  } catch (error) {
    console.error('Error cancelling jobs:', error);
    return NextResponse.json(
      { message: 'Failed to cancel jobs' },
      { status: 500 },
    );
  }
}
```

#### Cancel jobs by filter

You can also cancel only jobs matching certain criteria:

```typescript
// Cancel only email jobs
await jobQueue.cancelAllUpcomingJobs({ job_type: 'email' });

// Cancel only jobs with priority 2
await jobQueue.cancelAllUpcomingJobs({ priority: 2 });

// Cancel only jobs scheduled for a specific time
const runAt = new Date('2024-06-01T12:00:00Z');
await jobQueue.cancelAllUpcomingJobs({ run_at: runAt });

// Combine filters
await jobQueue.cancelAllUpcomingJobs({ job_type: 'email', priority: 2 });
```

This will set the status of all jobs that are still pending (not yet started or scheduled for the future) to `cancelled`.

### 7. Get Job(s)

To get a job by id:

```typescript
const job = await jobQueue.getJob(pool, jobId);
```

To get all jobs:

```typescript
const jobs = await jobQueue.getAllJobs(pool, limit, offset);
```

To get jobs by status:

```typescript
const jobs = await jobQueue.getJobsByStatus(pool, status, limit, offset);
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT

## Author

[Nico Prananta](https://nico.fyi)
