'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useState, useTransition } from 'react';
import { addGenericJob } from '@/app/jobs/add-job';
import { Loader2 } from 'lucide-react';

type JobDefinition = {
  label: string;
  title: string;
  description: string;
  features: string[];
  jobType: string;
  payload: () => Record<string, unknown>;
  extra?: Record<string, unknown>;
};

const jobDefinitions: JobDefinition[] = [
  {
    label: 'Add Email Job',
    title: 'Email Job',
    description:
      'Simulates sending an email. A simple fire-and-forget job that calls the email service with to, subject, and body fields. This handler throws error 50% of the time.',
    features: ['Basic job creation and processing'],
    jobType: 'send_email',
    payload: () => ({
      to: `user${Date.now()}@example.com`,
      subject: 'Welcome!',
      body: 'Hello from Dataqueue!',
    }),
  },
  {
    label: 'Add Report Job',
    title: 'Report Job',
    description:
      'Simulates generating a report for a user. Another straightforward job demonstrating basic job creation and processing. This handler throws error 50% of the time.',
    features: ['Basic job creation and processing'],
    jobType: 'generate_report',
    payload: () => ({
      reportId: `rpt-${Date.now()}`,
      userId: '123',
    }),
  },
  {
    label: 'Add Image Job',
    title: 'Image Job',
    description:
      'Simulates AI image generation with a 5-second timeout. Demonstrates timeout handling features. This handler throws error 50% of the time.',
    features: [
      'ctx.onTimeout() to extend the deadline before abort',
      'ctx.prolong() for heartbeat-style timeout extensions',
    ],
    jobType: 'generate_image',
    payload: () => ({ prompt: 'A beautiful sunset over mountains' }),
    extra: { timeoutMs: 5000 },
  },
  {
    label: 'Add Pipeline Job',
    title: 'Pipeline Job',
    description:
      'A multi-step data processing pipeline (fetch, transform, load). Demonstrates durable, resumable workflows.',
    features: [
      'ctx.run() for step memoization — steps survive retries',
      'ctx.waitFor() for time-based pauses between steps',
    ],
    jobType: 'data_pipeline',
    payload: () => ({
      source: 'postgres://source-db',
      destination: 's3://data-lake/output',
    }),
  },
  {
    label: 'Add Approval Job',
    title: 'Approval Job',
    description:
      'A human-in-the-loop approval workflow. The job pauses until an external signal (token) is completed.',
    features: [
      'ctx.createToken() to create an external approval token',
      'ctx.waitForToken() to pause until the token is resolved',
    ],
    jobType: 'approval_request',
    payload: () => ({
      requestType: 'deploy',
      description: 'Deploy v2.0 to production',
    }),
  },
];

export function QuickActions() {
  const [isPending, startTransition] = useTransition();
  const [selectedJob, setSelectedJob] = useState<JobDefinition | null>(null);

  const quickAdd = (job: JobDefinition) => {
    setSelectedJob(null);
    startTransition(async () => {
      await addGenericJob({
        jobType: job.jobType as never,
        payload: job.payload() as never,
        ...job.extra,
      });
    });
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {jobDefinitions.map((job) => (
            <Button
              key={job.jobType}
              size="sm"
              disabled={isPending}
              onClick={() => setSelectedJob(job)}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {job.label}
            </Button>
          ))}
        </div>
      </div>

      <Dialog
        open={selectedJob !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedJob(null);
        }}
      >
        {selectedJob && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedJob.title}</DialogTitle>
              <DialogDescription>{selectedJob.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                DataQueue features demonstrated:
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {selectedJob.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedJob(null)}>
                Cancel
              </Button>
              <Button onClick={() => quickAdd(selectedJob)}>Add Job</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
