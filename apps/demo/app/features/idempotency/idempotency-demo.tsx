'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addGenericJob } from '@/app/jobs/add-job';
import { Loader2 } from 'lucide-react';

export function IdempotencyDemo() {
  const [isPending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(
    `order-${Math.floor(Math.random() * 10000)}`,
  );
  const [results, setResults] = useState<string[]>([]);

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        const res = await addGenericJob({
          jobType: 'send_email',
          payload: {
            to: 'user@example.com',
            subject: `Order confirmation`,
            body: `Your order has been placed.`,
          },
          idempotencyKey,
        });
        setResults((prev) => [
          ...prev,
          `Attempt ${prev.length + 1}: Returned job ID ${res.job} (key: "${idempotencyKey}")`,
        ]);
      } catch (err) {
        setResults((prev) => [
          ...prev,
          `Attempt ${prev.length + 1}: Error - ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Test Idempotency</CardTitle>
          <CardDescription>
            Click &quot;Submit Job&quot; multiple times with the same key. Only
            the first call creates a new job; subsequent calls return the
            existing job ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Idempotency Key</Label>
            <Input
              id="key"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={isPending} size="sm">
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Submit Job
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending}
              size="sm"
              variant="outline"
            >
              Submit Again (same key)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIdempotencyKey(`order-${Math.floor(Math.random() * 10000)}`);
                setResults([]);
              }}
            >
              Reset Key
            </Button>
          </div>

          {results.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-sm font-medium">Results:</p>
              {results.map((r, i) => (
                <p key={i} className="text-sm text-muted-foreground font-mono">
                  {r}
                </p>
              ))}
              {results.length >= 2 && (
                <p className="text-sm text-primary font-medium mt-2">
                  Notice: All attempts return the same job ID -- no duplicates
                  created.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            When you call{' '}
            <code className="bg-muted px-1 rounded">
              addJob(&#123; idempotencyKey: &quot;my-key&quot; &#125;)
            </code>
            , the queue checks if a job with that key already exists:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              If no job exists with that key, a new job is created normally.
            </li>
            <li>
              If a job already exists (in any status), the existing job&apos;s
              ID is returned instead of creating a duplicate.
            </li>
          </ul>
          <p>
            This is useful for preventing duplicate processing when the same
            request might be retried (e.g., webhook retries, form
            double-submits).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
