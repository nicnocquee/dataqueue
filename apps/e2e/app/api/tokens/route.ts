import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/tokens - Create a new waitpoint token
 * Body: { timeout?, tags? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const queue = getJobQueue();
    const token = await queue.createToken({
      timeout: body.timeout,
      tags: body.tags,
    });
    return NextResponse.json({ token });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
