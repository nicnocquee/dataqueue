'use client';

import { useEffect, useTransition } from 'react';

export const RefreshPeriodically = ({
  interval = 5000,
  action,
}: {
  interval?: number;
  action?: () => Promise<unknown>;
}) => {
  const [, startTransition] = useTransition();
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (action) {
        startTransition(async () => {
          await action();
        });
      } else {
        clearInterval(intervalId);
      }
    }, interval);

    return () => clearInterval(intervalId);
  }, [interval, action]);

  return null;
};
