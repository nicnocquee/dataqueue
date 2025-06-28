import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';
import { createUser } from '@/lib/services/user';

export async function POST(request: NextRequest) {
  try {
    const { name, email } = await request.json();
    const userId = await createUser(name, email);

    // Add a welcome email job
    const jobQueue = await getJobQueue();
    await jobQueue.addJob({
      job_type: 'send_email',
      payload: {
        to: email,
        subject: 'Welcome to our platform!',
        body: `Hi ${name}, welcome to our platform!`,
      },
      priority: 10, // Higher number = higher priority
      run_at: new Date(Date.now() + 5 * 60 * 1000), // Run 5 minutes from now
    });

    return NextResponse.json({ userId }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { message: 'Failed to create user' },
      { status: 500 },
    );
  }
}
