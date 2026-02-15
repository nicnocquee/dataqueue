'use client';

import { Button } from '@/components/ui/button';
import { useTransition } from 'react';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2 } from 'lucide-react';

export function ProcessButton({ className }: { className?: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await processJobs();
        });
      }}
    >
      {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      Process Jobs Now
    </Button>
  );
}
