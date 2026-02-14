import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/maintenance/reclaim - Reclaim stuck jobs
 * Body: { maxProcessingTimeMinutes? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const queue = getJobQueue();
    const reclaimed = await queue.reclaimStuckJobs(
      body.maxProcessingTimeMinutes,
    );
    return NextResponse.json({ reclaimed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
