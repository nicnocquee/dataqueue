# pg-bg-job-queue

A lightweight, PostgreSQL-backed job queue for Node.js/TypeScript projects. Schedule, process, and manage background jobs with ease. Perfect for web apps (Next.js, etc.) deployed to serverless platforms like Vercel, AWS Lambda, etc.

## Features

- Simple API for adding and processing jobs
- Strong typing for job types and payloads which prevents you from adding jobs with the wrong payload type, and ensures that the job handler receives the correct payload type.
- Works with serverless environment
- Supports job priorities, scheduling, canceling, and retries
- Reclaim stuck jobs: No jobs will be stuck in the `processing` state indefinitely
- Cleanup old jobs: Keep only the last xxx days of jobs

## Who is this for?

If all of the following apply to you, then this package is for you:

|     |                                                                                             |
| --- | ------------------------------------------------------------------------------------------- |
| ☁️  | You're deploying a web app to serverless platforms like Vercel, AWS Lambda, etc.            |
| 📝  | You're using TypeScript                                                                     |
| ⚡  | You want your app to be fast and responsive by offloading heavy tasks to the background.    |
| 💾  | You're using PostgreSQL as your database                                                    |
| 🤷‍♂️  | You don't want to use and maintain another queue system like Redis                          |
| 💸  | You're on a budget and don't want to pay for a job queue service or running your own server |

## Installation

```bash
npm install pg-bg-job-queue pg node-pg-migrate
```

## Getting Started

In this example, we'll use a Next.js with App Router project which is deployed to Vercel.

The TL;DR is:

1. [Run migrations before deploying your app](#1-database-migrations)
2. [Initialize the job queue](#2-initialize-the-job-queue)
3. [Define job handlers](#3-define-job-handlers)
4. [Add a job](#4-add-a-job-eg-in-an-api-route-or-server-function)
5. Create three API routes to [process jobs](#5-process-jobs-eg-with-a-cron-job), [reclaim stuck jobs](#6-reclaim-stuck-jobs), and [cleanup old jobs](#7-cleanup-old-jobs)
6. Call those API routes periodically.

### 1. Database Migrations

After installing the package, add a script to your `package.json` to apply the migrations:

```json
"scripts": {
  "migrate-pg-bg-job-queue": "pg-bg-job-queue-cli migrate"
}
```

Then run the following command to apply the migrations:

```sh
npm run migrate-pg-bg-job-queue
```

This will apply all necessary schema migrations so that your Postgres database is ready to be used by pg-bg-job-queue. **The `PG_BG_JOB_QUEUE_DATABASE` environment variable must be set to your Postgres connection string**. The CLI will use this environment variable to connect to the database.

In your computer, you can run the following command to run the migrations with the environment variables from your `.env.local` file:

```bash
env $(cat .env.local | grep -v '^#' | xargs) pnpm run migrate-pg-bg-job-queue
```

This migrations needs to be run before you start using the job queue. For example, if you are deploying your app to Vercel, you need to run this command before deploying. This is similar to how Prisma and other ORMs manage migrations.

### 2. Initialize the Job Queue

Create a file (e.g., `lib/queue.ts`) to initialize and reuse the job queue instance. You need to define the job payload map for this app. The keys are the job types, and the values are the payload types. This prevents you from adding jobs with the wrong payload type.

```typescript:lib/queue.ts
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
        connectionString: process.env.PG_BG_JOB_QUEUE_DATABASE, // Set this in your environment
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

### 3. Define Job Handlers

Define your job handlers (e.g., in `lib/queue.ts`) which will be run when a job is processed. If you forget to add a handler for a job type, TypeScript will give you an error.

```typescript:lib/queue.ts
import { sendEmail } from './services/email';
import { generateReport } from './services/generate-report';
import { type JobPayloadMap } from './queue';

// Object literal mapping for static enforcement.
// This will ensure that every job type defined in `JobPayloadMap` has a corresponding handler, enforced at compile time by TypeScript.
// If you add a new job type to `JobPayloadMap` and forget to add a handler, TypeScript will give you an error.
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

// The queue initialization code in step 1...
```

### 4. Add a Job (e.g., in an API Route or Server Function)

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

### 5. Process Jobs (e.g., with a Cron Job)

Set up a route to process jobs in batches. This example is for API route (`/api/cron/process`) which can be triggered by a cron job:

```typescript:app/api/cron/process/route.ts
import { jobHandlers } from '@/lib/job-handler';
import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Secure the cron route: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jobQueue = await getJobQueue();

    // You can now control how many jobs are processed in parallel per batch using the `concurrency` option.
    // For example, to process at most 3 jobs in parallel per batch:
    const processor = jobQueue.createProcessor(jobHandlers, {
      workerId: `cron-${Date.now()}`,
      batchSize: 10, // up to 10 jobs per batch
      concurrency: 3, // at most 3 jobs processed in parallel
      verbose: true,
    });

    const processed = await processor.start();

    return NextResponse.json({
      message: 'Job processing completed',
      processed,
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

**Concurrency Option:**

- `concurrency` controls how many jobs are processed in parallel per batch.
- **Default is 3** (at most 3 jobs processed in parallel per batch).
- Set to `1` to process jobs sequentially.
- Set to a lower value to avoid resource exhaustion in resource-constrained environments.
- Set to a higher value to increase parallelism (use with caution).

#### Example: Vercel Cron Configuration

Add to your `vercel.json` to call the cron route every minute:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/process",
      "schedule": "* * * * *"
    }
  ]
}
```

In Vercel cron, the `CRON_SECRET` environment variable is sent as the `authorization` header. If you are using a different cron service, you need to set the `authorization` header to the `CRON_SECRET` value.

#### Failed Jobs

Failed jobs will be retried up to `max_attempts` times. If a job fails after `max_attempts` attempts, it will be set to `failed` status. The next attempt will be scheduled after `2^attempts * 1 minute` from the last attempt. You can get the error history of a job by checking the `error_history` field.

### 6. Reclaim Stuck Jobs

There are cases where a job is stuck in the `processing` state. This can happen if the process is killed or encounters an unhandled error after updating the job status but before marking it as `completed` or `failed`.

To reclaim stuck jobs, create another end point to do so. This example is for API route (`/api/cron/reclaim`) which can be triggered by a cron job:

```typescript:app/api/cron/reclaim/route.ts
import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Secure the cron route: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jobQueue = await getJobQueue();

    // Reclaim stuck jobs (10 minutes)
    const reclaimed = await jobQueue.reclaimStuckJobs(10);
    console.log(`Reclaimed ${reclaimed} stuck jobs`);

    return NextResponse.json({
      message: 'Stuck jobs reclaimed',
      reclaimed,
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

Add to your `vercel.json` to call the cron route every 10 minutes:

```json
{
  "crons": [
    {
      "path": "/api/cron/reclaim",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

### 7. Cleanup Old Jobs

When you have a lot of jobs, you might want to cleanup old jobs, e.g., keep only the last 30 days of jobs. This example is for API route (`/api/cron/cleanup`) which can be triggered by a cron job:

```typescript:app/api/cron/cleanup/route.ts
import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jobQueue = await getJobQueue();

    // Cleanup old jobs (keep for 30 days)
    const deleted = await jobQueue.cleanupOldJobs(30);
    console.log(`Deleted ${deleted} old jobs`);

    return NextResponse.json({
      message: 'Old jobs cleaned up',
      deleted,
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

Add to your `vercel.json` to call the cron route every day at midnight:

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 0 * * *"
    }
  ]
}
```

### 8. Cancel a Job

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

### 9. Cancel All Upcoming Jobs

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

### 10. Get Job(s)

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

## Additional Remarks

The update process uses `FOR UPDATE SKIP LOCKED` to prevent race conditions. This means that if two jobs are scheduled to run at the same time, only one will be processed. The other will be skipped. This is what makes Postgres suitable for this use case.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT

## Author

[Nico Prananta](https://nico.fyi)
