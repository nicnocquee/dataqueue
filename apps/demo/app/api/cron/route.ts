import { registerJobHandlers } from '@/lib/job-handler';
import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET() {
  // Optional: Authenticate the request (e.g., with a secret)
  // const authHeader = request.headers.get('authorization');
  // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  // }

  try {
    const jobQueue = await getJobQueue();

    await registerJobHandlers();

    const processor = jobQueue.createProcessor({
      workerId: `cron-${Date.now()}`,
      batchSize: 3,
      verbose: true,
    });

    await processor.start();

    // Clean up old jobs (keep for 30 days)
    const deleted = await jobQueue.cleanupOldJobs(30);
    console.log(`Deleted ${deleted} old jobs`);

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
