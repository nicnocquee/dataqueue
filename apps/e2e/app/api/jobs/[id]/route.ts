import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/jobs/[id] - Get a specific job
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const queue = getJobQueue();
    const job = await queue.getJob(Number(id));
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/jobs/[id] - Edit a job
 * Body: { payload?, maxAttempts?, priority?, runAt?, timeoutMs?, tags? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const queue = getJobQueue();
    const updates: Record<string, unknown> = {};
    if (body.payload !== undefined) updates.payload = body.payload;
    if (body.maxAttempts !== undefined) updates.maxAttempts = body.maxAttempts;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.runAt !== undefined)
      updates.runAt = body.runAt ? new Date(body.runAt) : null;
    if (body.timeoutMs !== undefined) updates.timeoutMs = body.timeoutMs;
    if (body.tags !== undefined) updates.tags = body.tags;

    await queue.editJob(Number(id), updates as any);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
