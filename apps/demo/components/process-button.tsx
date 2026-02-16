'use client';

import { Button } from '@/components/ui/button';
import { useTransition } from 'react';
import { processJobs } from '@/app/jobs/process-jobs';
import { Loader2, Info } from 'lucide-react';

export function ProcessButton({
  className,
  showHint = false,
}: {
  className?: string;
  showHint?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
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
      {showHint && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3 w-3 shrink-0" />
          No cron job is set up. Click the button above to manually process
          queued jobs.
        </p>
      )}
    </div>
  );
}
