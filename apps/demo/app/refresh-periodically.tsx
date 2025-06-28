'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatDistanceToNow } from 'date-fns';

export const RefreshPeriodically = ({
  interval = 5000,
  action,
}: {
  interval?: number;
  action?: () => Promise<unknown>;
}) => {
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [isRunning, startTransition] = useTransition();
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (action) {
        startTransition(async () => {
          await action();
          setLastRun(new Date());
        });
      } else {
        clearInterval(intervalId);
      }
    }, interval);

    return () => clearInterval(intervalId);
  }, [interval, action]);

  return (
    <div className="flex flex-row space-x-2 text-sm text-muted-foreground">
      <p>
        Last refresh: {lastRun ? formatDistanceToNow(lastRun) : 'Never'}. Is
        refreshing: {isRunning ? 'Yes' : 'No'}
      </p>
    </div>
  );
};
