'use client';

import { verifyChallenge } from './actions';

export function ChallengeForm({
  token,
  error,
}: {
  token: string;
  error?: string;
}) {
  return (
    <form action={verifyChallenge} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <input
          type="number"
          name="answer"
          placeholder="Your answer"
          required
          autoFocus
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tabular-nums shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        Submit
      </button>
    </form>
  );
}
