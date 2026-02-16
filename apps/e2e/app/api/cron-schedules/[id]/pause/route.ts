import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/cron-schedules/:id/pause - Pause a cron schedule
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await params;
    const queue = getJobQueue();
    await queue.pauseCronJob(Number(idParam));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
