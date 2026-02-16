import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/jobs/[id] - Get a specific job by ID.
 * Used by the React SDK's fetcher to poll job status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const queue = getJobQueue();
    const job = await queue.getJob(Number(id));
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
