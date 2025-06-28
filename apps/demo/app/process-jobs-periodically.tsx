'use client';

import { useEffect } from 'react';

export const ProcessJobsPeriodically = ({
  interval = 12000,
}: {
  interval?: number;
}) => {
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetch(`/api/cron`);
    }, interval);

    return () => clearInterval(intervalId);
  }, [interval]);

  return null;
};
