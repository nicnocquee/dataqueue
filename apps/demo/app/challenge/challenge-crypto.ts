import crypto from 'node:crypto';

const SECRET =
  process.env.CHALLENGE_SECRET || 'dataqueue-demo-challenge-fallback-secret';

const TOKEN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function generateChallengeToken(answer: number): string {
  const timestamp = Date.now().toString();
  const data = `${answer}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return `${data}:${hmac}`;
}

export function verifyChallengeToken(
  token: string,
  userAnswer: number,
): { valid: boolean; error?: string } {
  const parts = token.split(':');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format' };
  }

  const [expectedAnswer, timestamp, providedHmac] = parts;
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > TOKEN_MAX_AGE_MS) {
    return { valid: false, error: 'Challenge expired, please try again' };
  }

  const data = `${expectedAnswer}:${timestamp}`;
  const expectedHmac = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('hex');

  if (providedHmac !== expectedHmac) {
    return { valid: false, error: 'Invalid challenge' };
  }

  if (parseInt(expectedAnswer, 10) !== userAnswer) {
    return { valid: false, error: 'Wrong answer, try again' };
  }

  return { valid: true };
}
