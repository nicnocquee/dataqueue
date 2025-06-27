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

Create a file (e.g., `lib/job-queue.ts`) to initialize and reuse the job queue instance:

```typescript
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
    });
  }
  return jobQueuePromise;
};
```

### 2. Register Job Handlers

Define your job handlers (e.g., in `lib/job-handlers.ts`). Handlers process jobs by type:

```typescript
import { getJobQueue } from './job-queue';
import { sendEmail } from './email-service';
import { generateReport } from './report-service';

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

### 3. Add a Job (e.g., in an API Route)

Add jobs to the queue from your application logic:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/job-queue';
import { createUser } from '@/lib/user-service';

export async function POST(request: NextRequest) {
  try {
    const { name, email } = await request.json();
    const userId = await createUser(name, email);

    // Add a welcome email job
    const jobQueue = await getJobQueue();
    await jobQueue.addJob({
      job_type: 'send_email',
      payload: {
        to: email,
        subject: 'Welcome to our platform!',
        body: `Hi ${name}, welcome to our platform!`,
      },
      priority: 10, // Higher number = higher priority
      run_at: new Date(Date.now() + 5 * 60 * 1000), // Run 5 minutes from now
    });

    return NextResponse.json({ userId }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { message: 'Failed to create user' },
      { status: 500 },
    );
  }
}
```

### 4. Process Jobs (e.g., with a Cron Job)

Set up a route to process jobs in batches. This example is for a Next.js API route triggered by a cron job:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/job-queue';
import { registerJobHandlers } from '@/lib/job-handlers';

export async function GET(request: NextRequest) {
  // Optional: Authenticate the request (e.g., with a secret)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jobQueue = await getJobQueue();
    await registerJobHandlers();

    // Create a processor instance
    const processor = jobQueue.createProcessor({
      workerId: `cron-${Date.now()}`,
      batchSize: 20,
    });

    processor.start();
    // Process for up to 50 seconds (Vercel has a 60s limit)
    await new Promise((resolve) => setTimeout(resolve, 50000));
    processor.stop();

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

Add to your `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/process-jobs",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

## Advanced Usage

### 1. Job Dashboard API (List Jobs)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/job-queue';

export async function GET(request: NextRequest) {
  // Add authentication as needed
  try {
    const jobQueue = await getJobQueue();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'pending';
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const jobs = await jobQueue.getJobsByStatus(status, limit, offset);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { message: 'Failed to fetch jobs' },
      { status: 500 },
    );
  }
}
```

### 2. Retry Failed Job API

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/job-queue';

export async function POST(request: NextRequest) {
  // Add authentication as needed
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json(
        { message: 'Job ID is required' },
        { status: 400 },
      );
    }
    const jobQueue = await getJobQueue();
    await jobQueue.retryJob(jobId);
    return NextResponse.json({ message: 'Job queued for retry' });
  } catch (error) {
    console.error('Error retrying job:', error);
    return NextResponse.json(
      { message: 'Failed to retry job' },
      { status: 500 },
    );
  }
}
```

## Troubleshooting & FAQ

- **Database connection issues?** Ensure your `DATABASE_URL` is set and accessible from your environment.
- **Jobs not processing?** Make sure your job handlers are registered before processing jobs.
- **Need to process jobs automatically?** Use a cron job or background worker to call your processing endpoint regularly.

## Contributing

Contributions are welcome! Please open issues or pull requests for bugs, features, or documentation improvements.

## License

MIT
