import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/jobs - Add a new job
 * Body: { jobType, payload, maxAttempts?, priority?, runAt?, timeoutMs?, forceKillOnTimeout?, tags?, idempotencyKey? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const queue = getJobQueue();
    const id = await queue.addJob({
      jobType: body.jobType,
      payload: body.payload,
      maxAttempts: body.maxAttempts,
      priority: body.priority,
      runAt: body.runAt ? new Date(body.runAt) : undefined,
      timeoutMs: body.timeoutMs,
      forceKillOnTimeout: body.forceKillOnTimeout,
      tags: body.tags,
      idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET /api/jobs - Query jobs
 * Query params: status?, jobType?, tags?, tagMode?, limit?, offset?
 */
export async function GET(request: NextRequest) {
  try {
    const queue = getJobQueue();
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const jobType = params.get('jobType');
    const tagsRaw = params.get('tags');
    const tagMode = params.get('tagMode') as
      | 'exact'
      | 'all'
      | 'any'
      | 'none'
      | null;
    const limit = params.get('limit') ? Number(params.get('limit')) : undefined;
    const offset = params.get('offset')
      ? Number(params.get('offset'))
      : undefined;

    // If querying by tags
    if (tagsRaw) {
      const tags = tagsRaw.split(',');
      const jobs = await queue.getJobsByTags(
        tags,
        tagMode || 'all',
        limit,
        offset,
      );
      return NextResponse.json({ jobs });
    }

    // If querying by status
    if (status) {
      const jobs = await queue.getJobsByStatus(status, limit, offset);
      return NextResponse.json({ jobs });
    }

    // If querying with filters
    if (jobType) {
      const jobs = await queue.getJobs({ jobType }, limit, offset);
      return NextResponse.json({ jobs });
    }

    // Default: get all jobs
    const jobs = await queue.getAllJobs(limit, offset);
    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
