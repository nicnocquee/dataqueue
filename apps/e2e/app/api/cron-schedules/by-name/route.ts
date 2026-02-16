import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/cron-schedules/by-name?name=... - Get a cron schedule by name
 */
export async function GET(request: NextRequest) {
  try {
    const name = request.nextUrl.searchParams.get('name');
    if (!name) {
      return NextResponse.json(
        { error: 'name query parameter is required' },
        { status: 400 },
      );
    }
    const queue = getJobQueue();
    const schedule = await queue.getCronJobByName(name);
    return NextResponse.json({ schedule });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
