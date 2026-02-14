import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/bulk/edit - Edit all pending jobs matching filters
 * Body: { filters?: { jobType?, priority?, tags? }, updates: { payload?, priority?, tags?, ... } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const queue = getJobQueue();
    const updated = await queue.editAllPendingJobs(body.filters, body.updates);
    return NextResponse.json({ updated });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
