import { NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/cron-schedules/enqueue - Enqueue all due cron jobs
 */
export async function POST() {
  try {
    const queue = getJobQueue();
    const enqueued = await queue.enqueueDueCronJobs();
    return NextResponse.json({ enqueued });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
