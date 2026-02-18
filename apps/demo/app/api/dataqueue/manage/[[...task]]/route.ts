/**
 * This end point is used to manage the job queue.
 * It supports the following tasks:
 * - reclaim: Reclaim stuck jobs
 * - cleanup: Cleanup old jobs
 * - process: Process jobs
 *
 * Example usage with default values (reclaim stuck jobs for 10 minutes, cleanup old jobs for 30 days, and process jobs with batch size 3, concurrency 2, and verbose true):
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET"
 *
 * Example usage with custom values:
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET" -d '{"maxProcessingTimeMinutes": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET" -d '{"daysToKeep": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET" -d '{"batchSize": 5, "concurrency": 3, "verbose": false, "workerId": "custom-worker-id"}' -H "Content-Type: application/json"
 *
 * During development, you can run the following script to run the cron jobs continuously in the background:
 * pnpm cron
 */
import { getJobQueue, jobHandlers } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ task: string[] }> },
) {
  const { task } = await params;
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  if (!task || task.length === 0) {
    return NextResponse.json({ message: 'Task is required' }, { status: 400 });
  }

  const supportedTasks = ['reclaim', 'cleanup', 'process'];
  const theTask = task[0];
  if (!supportedTasks.includes(theTask)) {
    return NextResponse.json(
      { message: 'Task not supported' },
      { status: 400 },
    );
  }

  try {
    const jobQueue = getJobQueue();

    if (theTask === 'reclaim') {
      let maxProcessingTimeMinutes = 10;
      try {
        const body = await request.json();
        maxProcessingTimeMinutes = body.maxProcessingTimeMinutes || 10;
      } catch {
        // ignore parsing error and use default value
      }
      const reclaimed = await jobQueue.reclaimStuckJobs(
        maxProcessingTimeMinutes,
      );
      console.log(`Reclaimed ${reclaimed} stuck jobs`);
      return NextResponse.json({
        message: `Stuck jobs reclaimed: ${reclaimed} with maxProcessingTimeMinutes: ${maxProcessingTimeMinutes}`,
        reclaimed,
      });
    }

    if (theTask === 'cleanup') {
      let daysToKeep = 30;
      try {
        const body = await request.json();
        daysToKeep = body.daysToKeep || 30;
      } catch {
        // ignore parsing error and use default value
      }
      const deleted = await jobQueue.cleanupOldJobs(daysToKeep);
      console.log(`Deleted ${deleted} old jobs`);
      return NextResponse.json({
        message: `Old jobs cleaned up: ${deleted} with daysToKeep: ${daysToKeep}`,
        deleted,
      });
    }

    if (theTask === 'process') {
      let batchSize = 3;
      let concurrency = 2;
      let verbose = true;
      let workerId = `manage-${theTask}-${Date.now()}`;
      try {
        const body = await request.json();
        batchSize = body.batchSize || 3;
        concurrency = body.concurrency || 2;
        verbose = body.verbose || true;
        workerId = body.workerId || `manage-${theTask}-${Date.now()}`;
      } catch {
        // ignore parsing error and use default value
      }
      const processor = jobQueue.createProcessor(jobHandlers, {
        workerId,
        batchSize,
        concurrency,
        verbose,
      });
      const processed = await processor.start();

      return NextResponse.json({
        message: `Jobs processed: ${processed} with workerId: ${workerId}, batchSize: ${batchSize}, concurrency: ${concurrency}, and verbose: ${verbose}`,
        processed,
      });
    }

    return NextResponse.json(
      { message: 'Task not supported' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Error processing jobs:', error);
    return NextResponse.json(
      { message: 'Failed to process jobs' },
      { status: 500 },
    );
  }
}
