import { getJobQueue, jobHandlers } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const jobQueue = await getJobQueue();

    const processor = jobQueue.createProcessor(jobHandlers, {
      workerId: `cron-${Date.now()}`,
      batchSize: 3,
      concurrency: 2,
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
