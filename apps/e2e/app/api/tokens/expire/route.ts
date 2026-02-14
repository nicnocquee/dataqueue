import { NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * POST /api/tokens/expire - Expire all timed-out tokens
 */
export async function POST() {
  try {
    const queue = getJobQueue();
    const expired = await queue.expireTimedOutTokens();
    return NextResponse.json({ expired });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
