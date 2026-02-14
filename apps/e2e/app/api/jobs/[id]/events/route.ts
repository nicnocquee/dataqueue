import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/jobs/[id]/events - Get events for a specific job
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const queue = getJobQueue();
    const events = await queue.getJobEvents(Number(id));
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
