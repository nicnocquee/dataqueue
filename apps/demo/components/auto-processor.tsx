'use client';

import { useEffect, useRef, useTransition } from 'react';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

const DEFAULT_INTERVAL_MS = 20_000;

/**
 * Automatically processes queued jobs on a fixed interval while mounted.
 * Skips a tick when the previous processing call is still in-flight.
 *
 * @param props.intervalMs - Polling interval in milliseconds (default 20 000).
 * @param props.action     - Server action to invoke each tick. Defaults to the
 *                           production `processJobs` action; accept via DI for testing.
 * @param props.className  - Optional CSS class forwarded to the root element.
 */
export function AutoProcessor({
  intervalMs = DEFAULT_INTERVAL_MS,
  action = processJobs,
  className,
}: {
  intervalMs?: number;
  action?: () => Promise<unknown>;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const pendingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = isPending;
  }, [isPending]);

  useEffect(() => {
    const id = setInterval(() => {
      if (pendingRef.current) return;
      startTransition(async () => {
        await action();
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, action]);

  return (
    <div className={className}>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
        )}
        {isPending ? 'Processing...' : 'Auto-processing'}
      </span>
    </div>
  );
}
