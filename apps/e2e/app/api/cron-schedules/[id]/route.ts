import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/cron-schedules/:id - Get a cron schedule by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await params;
    const queue = getJobQueue();
    const schedule = await queue.getCronJob(Number(idParam));
    return NextResponse.json({ schedule });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * DELETE /api/cron-schedules/:id - Remove a cron schedule
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await params;
    const queue = getJobQueue();
    await queue.removeCronJob(Number(idParam));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/cron-schedules/:id - Edit a cron schedule
 * Body: { cronExpression?, payload?, maxAttempts?, priority?, timeoutMs?, tags?, timezone?, allowOverlap?, nextRunAt? }
 *
 * The `nextRunAt` field is a test-only override that directly sets the next run
 * timestamp via SQL so e2e tests can force a schedule to be "due" deterministically.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await params;
    const body = await request.json();
    const { nextRunAt, ...updates } = body;
    const queue = getJobQueue();

    if (Object.keys(updates).length > 0) {
      await queue.editCronJob(Number(idParam), updates);
    }

    // Test-only: force nextRunAt via direct SQL so overlap tests are deterministic
    if (nextRunAt !== undefined) {
      const pool = queue.getPool();
      await pool.query(
        'UPDATE cron_schedules SET next_run_at = $1 WHERE id = $2',
        [new Date(nextRunAt), Number(idParam)],
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
