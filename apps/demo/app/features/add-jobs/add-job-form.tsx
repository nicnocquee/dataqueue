'use client';

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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addGenericJob } from '@/app/jobs/add-job';
import { processJobs } from '@/app/jobs/process-jobs';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';

const defaultPayloads: Record<string, string> = {
  send_email: JSON.stringify(
    { to: 'user@example.com', subject: 'Welcome!', body: 'Hello!' },
    null,
    2,
  ),
  generate_report: JSON.stringify(
    { reportId: 'rpt-001', userId: '123' },
    null,
    2,
  ),
  generate_image: JSON.stringify(
    { prompt: 'A beautiful sunset over mountains' },
    null,
    2,
  ),
  data_pipeline: JSON.stringify(
    { source: 'postgres://source-db', destination: 's3://data-lake/output' },
    null,
    2,
  ),
  approval_request: JSON.stringify(
    { requestType: 'deploy', description: 'Deploy v2.0 to production' },
    null,
    2,
  ),
};

export function AddJobForm() {
  const [isPending, startTransition] = useTransition();
  const [jobType, setJobType] = useState('send_email');
  const [payload, setPayload] = useState(defaultPayloads.send_email);
  const [priority, setPriority] = useState('5');
  const [tags, setTags] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [runAtDelay, setRunAtDelay] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('3');
  const [forceKill, setForceKill] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleTypeChange = (type: string) => {
    setJobType(type);
    setPayload(defaultPayloads[type] ?? '{}');
    if (type === 'generate_image') {
      setTimeoutMs('5000');
    } else {
      setTimeoutMs('');
    }
  };

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        const parsedPayload = JSON.parse(payload);
        const parsedTags = tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const res = await addGenericJob({
          jobType: jobType as never,
          payload: parsedPayload,
          priority: priority ? Number(priority) : undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
          idempotencyKey: idempotencyKey || undefined,
          runAtDelay: runAtDelay ? Number(runAtDelay) : undefined,
          timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
          forceKillOnTimeout: forceKill || undefined,
          maxAttempts: maxAttempts ? Number(maxAttempts) : undefined,
        });
        setResult(`Job created with ID: ${res.job}`);
      } catch (err) {
        setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const handleProcess = () => {
    startTransition(async () => {
      await processJobs();
      setResult('Processing triggered');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a Job</CardTitle>
        <CardDescription>
          Fill in the options below and click &quot;Add Job&quot; to enqueue it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="jobType">Job Type</Label>
            <Select value={jobType} onValueChange={handleTypeChange}>
              <SelectTrigger id="jobType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send_email">send_email</SelectItem>
                <SelectItem value="generate_report">generate_report</SelectItem>
                <SelectItem value="generate_image">generate_image</SelectItem>
                <SelectItem value="data_pipeline">data_pipeline</SelectItem>
                <SelectItem value="approval_request">
                  approval_request
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority (higher = first)</Label>
            <Input
              id="priority"
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="5"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="payload">Payload (JSON)</Label>
            <Textarea
              id="payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="urgent, finance, report"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="idempotencyKey">Idempotency Key (optional)</Label>
            <Input
              id="idempotencyKey"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="unique-key-123"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="runAtDelay">Schedule Delay (seconds)</Label>
            <Input
              id="runAtDelay"
              type="number"
              value={runAtDelay}
              onChange={(e) => setRunAtDelay(e.target.value)}
              placeholder="0 (immediate)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeoutMs">Timeout (ms)</Label>
            <Input
              id="timeoutMs"
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              placeholder="No timeout"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxAttempts">Max Attempts</Label>
            <Input
              id="maxAttempts"
              type="number"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              placeholder="3"
            />
          </div>

          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="forceKill"
              checked={forceKill}
              onCheckedChange={setForceKill}
            />
            <Label htmlFor="forceKill">Force Kill on Timeout</Label>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-6">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Add Job
          </Button>
          <Button
            variant="outline"
            onClick={handleProcess}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Process Jobs Now
          </Button>
        </div>

        {result && (
          <p className="text-sm mt-3 text-muted-foreground">{result}</p>
        )}
      </CardContent>
    </Card>
  );
}
