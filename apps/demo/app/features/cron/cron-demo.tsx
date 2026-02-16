'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Pause, Play, Trash2, Zap } from 'lucide-react';
import {
  addCronSchedule,
  listCronSchedules,
  pauseCronSchedule,
  resumeCronSchedule,
  removeCronSchedule,
  enqueueDueCronJobs,
} from '@/app/jobs/cron-actions';

type CronSchedule = {
  id: number;
  scheduleName: string;
  cronExpression: string;
  jobType: string;
  payload: Record<string, unknown>;
  timezone: string;
  allowOverlap: boolean;
  status: string;
  lastEnqueuedAt: Date | null;
  lastJobId: number | null;
  nextRunAt: Date | null;
  createdAt: Date;
};

export function CronDemo() {
  const [isPending, startTransition] = useTransition();
  const [schedules, setSchedules] = useState<CronSchedule[]>([]);
  const [results, setResults] = useState<string[]>([]);

  // Form state
  const [name, setName] = useState('daily-report');
  const [cron, setCron] = useState('0 9 * * *');
  const [jobType, setJobType] = useState('generate_report');
  const [timezone, setTimezone] = useState('UTC');
  const [allowOverlap, setAllowOverlap] = useState(false);

  const addResult = (msg: string) => {
    setResults((prev) => [msg, ...prev].slice(0, 10));
  };

  const loadSchedules = useCallback(() => {
    startTransition(async () => {
      const { schedules: data } = await listCronSchedules();
      setSchedules(data as unknown as CronSchedule[]);
    });
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Add Cron Schedule</CardTitle>
            <CardDescription className="text-xs">
              Define a recurring job with a cron expression using{' '}
              <code className="bg-muted px-0.5 rounded">addCronJob()</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Schedule Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="daily-report"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cron Expression</Label>
              <Input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 9 * * *"
              />
              <p className="text-xs text-muted-foreground">
                5-field format: minute hour day month weekday
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Job Type</Label>
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_email">send_email</SelectItem>
                  <SelectItem value="generate_report">
                    generate_report
                  </SelectItem>
                  <SelectItem value="data_pipeline">data_pipeline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="America/New_York">
                    America/New_York
                  </SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="allowOverlap"
                checked={allowOverlap}
                onChange={(e) => setAllowOverlap(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="allowOverlap" className="text-xs">
                Allow overlap (skip protection)
              </Label>
            </div>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const defaultPayloads: Record<
                      string,
                      Record<string, unknown>
                    > = {
                      send_email: {
                        to: 'admin@example.com',
                        subject: 'Scheduled report',
                        body: 'Your daily report is ready.',
                      },
                      generate_report: {
                        reportId: 'daily',
                        userId: 'system',
                      },
                      data_pipeline: {
                        source: 's3://data/input',
                        destination: 's3://data/output',
                      },
                    };
                    const { id } = await addCronSchedule({
                      scheduleName: name,
                      cronExpression: cron,
                      jobType,
                      payload: defaultPayloads[jobType] || {},
                      timezone,
                      allowOverlap,
                    });
                    addResult(`Created schedule #${id}: ${name} (${cron})`);
                    loadSchedules();
                  } catch (err) {
                    addResult(`Error: ${err}`);
                  }
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Add Schedule
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automatic Enqueueing</CardTitle>
            <CardDescription className="text-xs">
              The processor automatically enqueues due cron jobs before each
              batch. Use the button below to trigger it manually for testing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const { enqueued } = await enqueueDueCronJobs();
                  addResult(`Manually enqueued ${enqueued} cron job(s)`);
                  loadSchedules();
                })
              }
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              <Zap className="h-3 w-3 mr-1" />
              Trigger Manually
            </Button>
            <p className="text-xs text-muted-foreground">
              In production,{' '}
              <code className="bg-muted px-0.5 rounded">processor.start()</code>{' '}
              and{' '}
              <code className="bg-muted px-0.5 rounded">
                processor.startInBackground()
              </code>{' '}
              handle this automatically. Overlap protection will skip if the
              previous instance is still pending, processing, or waiting.
            </p>
          </CardContent>
        </Card>
      </div>

      {schedules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Schedules</CardTitle>
            <CardDescription className="text-xs">
              {schedules.length} schedule(s) defined
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {s.scheduleName}
                      </span>
                      <Badge
                        variant={
                          s.status === 'active' ? 'default' : 'secondary'
                        }
                        className="text-[10px] px-1.5 py-0"
                      >
                        {s.status}
                      </Badge>
                      {!s.allowOverlap && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          no-overlap
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>
                        <strong>Cron:</strong>{' '}
                        <code className="bg-muted px-0.5 rounded">
                          {s.cronExpression}
                        </code>{' '}
                        ({s.timezone})
                      </p>
                      <p>
                        <strong>Job type:</strong> {s.jobType}
                      </p>
                      {s.nextRunAt && (
                        <p>
                          <strong>Next run:</strong>{' '}
                          {new Date(s.nextRunAt).toLocaleString()}
                        </p>
                      )}
                      {s.lastEnqueuedAt && (
                        <p>
                          <strong>Last enqueued:</strong>{' '}
                          {new Date(s.lastEnqueuedAt).toLocaleString()}
                          {s.lastJobId !== null && ` (job #${s.lastJobId})`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {s.status === 'active' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(async () => {
                            await pauseCronSchedule(s.id);
                            addResult(`Paused schedule: ${s.scheduleName}`);
                            loadSchedules();
                          })
                        }
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(async () => {
                            await resumeCronSchedule(s.id);
                            addResult(`Resumed schedule: ${s.scheduleName}`);
                            loadSchedules();
                          })
                        }
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await removeCronSchedule(s.id);
                          addResult(`Removed schedule: ${s.scheduleName}`);
                          loadSchedules();
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {results.map((r, i) => (
                <p key={i} className="text-sm text-muted-foreground font-mono">
                  {r}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
