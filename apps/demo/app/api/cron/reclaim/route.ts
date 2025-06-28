import { getJobQueue } from '@/lib/queue';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
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
