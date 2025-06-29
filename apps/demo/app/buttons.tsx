'use client';

import { Button } from '@/components/ui/button';
import { sendEmail } from './jobs/email';
import { generateReport } from './jobs/report';
import { useTransition } from 'react';
import { cancelPendingJobs } from './jobs/cancel';
import { generateImage } from './jobs/generate-image';

export default function Buttons() {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-row gap-2">
      <Button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const job = await sendEmail({
              name: `John Doe ${Date.now()}`,
              email: `john.doe${Date.now()}@example.com`,
            });
            console.log(job);
          });
        }}
      >
        Send E-mail
      </Button>
      <Button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const job = await generateReport({
              name: `John Doe ${Date.now()}`,
              email: `john.doe${Date.now()}@example.com`,
              reportId: `report-${Date.now()}`,
            });
            console.log(job);
          });
        }}
      >
        Generate Report
      </Button>
      <Button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const job = await generateImage({ prompt: 'A beautiful sunset' });
            console.log(job);
          });
        }}
      >
        Generate Image
      </Button>
      <Button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await cancelPendingJobs();
          });
        }}
      >
        Cancel Pending Jobs
      </Button>
    </div>
  );
}
