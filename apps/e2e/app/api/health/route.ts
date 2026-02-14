import { NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

export async function GET() {
  try {
    const queue = getJobQueue();
    const pool = queue.getPool();
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: String(error) },
      { status: 500 },
    );
  }
}
