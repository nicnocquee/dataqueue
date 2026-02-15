'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getJobEventsAction } from './get-events-action';
import { Loader2 } from 'lucide-react';

type EventResult = {
  id: number;
  eventType: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export function EventsDemo() {
  const [isPending, startTransition] = useTransition();
  const [jobId, setJobId] = useState('');
  const [events, setEvents] = useState<EventResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = () => {
    if (!jobId) return;
    startTransition(async () => {
      try {
        const result = await getJobEventsAction(Number(jobId));
        setEvents(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch events');
        setEvents(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Look Up Job Events</CardTitle>
          <CardDescription>
            Enter a job ID to see its full event timeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="jobId">Job ID</Label>
              <Input
                id="jobId"
                type="number"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                placeholder="Enter a job ID"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLookup();
                }}
              />
            </div>
            <Button
              size="sm"
              onClick={handleLookup}
              disabled={isPending || !jobId}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Look Up Events
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {events !== null && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {events.length} event(s) for job #{jobId}
              </p>
              {events.length > 0 ? (
                <div className="border rounded-md">
                  <div className="relative pl-6">
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className="relative border-l-2 border-border pl-4 pb-4 last:pb-0 ml-2"
                      >
                        <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full border-2 border-background bg-primary" />
                        <div className="pt-0">
                          <div className="flex items-center gap-2">
                            <EventBadge type={event.eventType} />
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {event.metadata &&
                            Object.keys(event.metadata).length > 0 && (
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded mt-1 block max-w-lg truncate">
                                {JSON.stringify(event.metadata)}
                              </code>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No events found for this job.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              'added',
              'processing',
              'completed',
              'failed',
              'cancelled',
              'retried',
              'edited',
              'prolonged',
              'waiting',
            ].map((type) => (
              <EventBadge key={type} type={type} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const variant =
    {
      added: 'outline' as const,
      processing: 'default' as const,
      completed: 'secondary' as const,
      failed: 'destructive' as const,
      cancelled: 'outline' as const,
      retried: 'secondary' as const,
      edited: 'secondary' as const,
      prolonged: 'outline' as const,
      waiting: 'secondary' as const,
    }[type] ?? ('outline' as const);

  return (
    <Badge variant={variant} className="text-xs">
      {type}
    </Badge>
  );
}
