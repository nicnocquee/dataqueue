'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyChallengeToken } from './challenge-crypto';

export async function verifyChallenge(formData: FormData) {
  const answer = parseInt(formData.get('answer') as string, 10);
  const token = formData.get('token') as string;

  if (isNaN(answer) || !token) {
    redirect('/challenge?error=Please+provide+an+answer');
  }

  const result = verifyChallengeToken(token, answer);

  if (!result.valid) {
    redirect(`/challenge?error=${encodeURIComponent(result.error!)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set('demo_access', 'granted', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  });

  redirect('/');
}
