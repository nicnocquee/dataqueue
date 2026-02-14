import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/bulk/cancel - Cancel all upcoming jobs
 * Body: { filters?: { jobType?, priority?, tags? } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const queue = getJobQueue();
    const cancelled = await queue.cancelAllUpcomingJobs(body.filters);
    return NextResponse.json({ cancelled });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
