import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    // Add a generate image job
    const jobQueue = getJobQueue();
    await jobQueue.addJob({
      jobType: 'generate_image',
      payload: {
        prompt,
      },
      priority: 5, // Higher number = higher priority
      runAt: new Date(Date.now() + 1000), // Run 1 second from now
      timeoutMs: 5000, // 5 second timeout
    });

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      { message: 'Failed to generate image' },
      { status: 500 },
    );
  }
}
