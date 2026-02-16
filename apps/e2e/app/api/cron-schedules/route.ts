import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/cron-schedules - Add a cron schedule
 * Body: { scheduleName, cronExpression, jobType, payload, timezone?, allowOverlap?, maxAttempts?, priority?, tags? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const queue = getJobQueue();
    const id = await queue.addCronJob(body);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET /api/cron-schedules - List cron schedules
 * Query: ?status=active|paused
 */
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status') as
      | 'active'
      | 'paused'
      | null;
    const queue = getJobQueue();
    const schedules = await queue.listCronJobs(status ?? undefined);
    return NextResponse.json({ schedules });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
