import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue, jobHandlers } from '@/lib/queue';

/**
 * POST /api/process - Process a batch of jobs
 * Body: { batchSize?, concurrency?, jobType? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const queue = getJobQueue();
    const processor = queue.createProcessor(jobHandlers, {
      batchSize: body.batchSize ?? 10,
      concurrency: body.concurrency ?? 3,
      verbose: false,
      jobType: body.jobType,
    });
    const count = await processor.start();
    return NextResponse.json({ processed: count });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
