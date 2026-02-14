import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

/**
 * GET /api/tokens/[id] - Get a specific token
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const queue = getJobQueue();
    const token = await queue.getToken(id);
    if (!token) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }
    return NextResponse.json({ token });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
