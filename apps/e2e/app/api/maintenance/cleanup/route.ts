import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/maintenance/cleanup - Clean up old jobs
 * Body: { daysToKeep? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const queue = getJobQueue();
    const deleted = await queue.cleanupOldJobs(body.daysToKeep);
    return NextResponse.json({ deleted });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
