import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/jobs/batch — insert multiple jobs (supports batch-relative dependsOn.jobIds).
 * Body: { jobs: JobOptions[] } — same fields as POST /api/jobs per item.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const jobs = body.jobs as Array<{
      jobType: string;
      payload: unknown;
      maxAttempts?: number;
      priority?: number;
      runAt?: string;
      timeoutMs?: number;
      forceKillOnTimeout?: boolean;
      tags?: string[];
      idempotencyKey?: string;
      dependsOn?: { jobIds?: number[]; tags?: string[] };
    }>;
    if (!Array.isArray(jobs)) {
      return NextResponse.json(
        { error: 'Expected body.jobs to be an array' },
        { status: 400 },
      );
    }
    const queue = getJobQueue();
    const ids = await queue.addJobs(
      jobs.map((j) => ({
        jobType: j.jobType,
        payload: j.payload,
        maxAttempts: j.maxAttempts,
        priority: j.priority,
        runAt: j.runAt ? new Date(j.runAt) : undefined,
        timeoutMs: j.timeoutMs,
        forceKillOnTimeout: j.forceKillOnTimeout,
        tags: j.tags,
        idempotencyKey: j.idempotencyKey,
        dependsOn: j.dependsOn,
      })),
    );
    return NextResponse.json({ ids });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
