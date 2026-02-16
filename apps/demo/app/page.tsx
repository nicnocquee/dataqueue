export const dynamic = 'force-dynamic';

import { FeaturePage } from '@/components/feature-page';
import { JobMonitor } from '@/components/job-monitor';
import { QuickActions } from '@/components/quick-actions';
import { RefreshPeriodically } from './refresh-periodically';
import { refresh } from './queue/refresh';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Plus,
  Tags,
  Settings,
  Key,
  Timer,
  Pause,
  Layers,
  Activity,
  Wrench,
  Monitor,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';

const features = [
  {
    title: 'Add & Process Jobs',
    description: 'Create jobs with all options and trigger processing',
    href: '/features/add-jobs',
    icon: Plus,
    docsUrl: 'https://docs.dataqueue.dev/usage/add-job',
  },
  {
    title: 'Tags & Filtering',
    description: 'Tag jobs and filter by tags with different modes',
    href: '/features/tags',
    icon: Tags,
    docsUrl: 'https://docs.dataqueue.dev/usage/get-jobs',
  },
  {
    title: 'Job Management',
    description: 'Retry, cancel, and edit individual jobs',
    href: '/features/management',
    icon: Settings,
    docsUrl: 'https://docs.dataqueue.dev/usage/cancel-jobs',
  },
  {
    title: 'Idempotency',
    description: 'Prevent duplicate jobs with idempotency keys',
    href: '/features/idempotency',
    icon: Key,
    docsUrl: 'https://docs.dataqueue.dev/usage/add-job',
  },
  {
    title: 'Timeouts',
    description: 'Timeout handling, prolong, onTimeout, force kill',
    href: '/features/timeouts',
    icon: Timer,
    docsUrl: 'https://docs.dataqueue.dev/usage/job-timeout',
  },
  {
    title: 'Waitpoints & Tokens',
    description:
      'Pause jobs with waitFor/waitUntil and human-in-the-loop tokens',
    href: '/features/waitpoints',
    icon: Pause,
    docsUrl: 'https://docs.dataqueue.dev/usage/wait',
  },
  {
    title: 'Step Memoization',
    description: 'Multi-step jobs with ctx.run for durable execution',
    href: '/features/steps',
    icon: Layers,
    docsUrl: 'https://docs.dataqueue.dev/usage/job-handlers',
  },
  {
    title: 'Job Events',
    description: 'View the full event history for any job',
    href: '/features/events',
    icon: Activity,
    docsUrl: 'https://docs.dataqueue.dev/usage/job-events',
  },
  {
    title: 'Maintenance',
    description: 'Cleanup old jobs/events and reclaim stuck jobs',
    href: '/features/maintenance',
    icon: Wrench,
    docsUrl: 'https://docs.dataqueue.dev/usage/cleanup-jobs',
  },
  {
    title: 'React SDK',
    description: 'Track job status and progress in real time with useJob hook',
    href: '/features/react-sdk',
    icon: Monitor,
    docsUrl: 'https://docs.dataqueue.dev/usage/react-sdk',
  },
];

export default function Home() {
  return (
    <FeaturePage
      title="Dataqueue Feature Demo"
      description="A lightweight, type-safe job queue for Node.js with PostgreSQL or Redis. Explore each feature using the sidebar navigation or the cards below."
    >
      <RefreshPeriodically key="refresh" action={refresh} interval={10000} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Add sample jobs or trigger processing to see the queue in action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuickActions />
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.href}
              className="h-full hover:border-primary/50 transition-colors"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <feature.icon className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">
                    <Link href={feature.href} className="hover:underline">
                      {feature.title}
                    </Link>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href={feature.href}>
                  <p className="text-xs text-muted-foreground cursor-pointer">
                    {feature.description}
                  </p>
                </Link>
                <a
                  href={feature.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Docs
                </a>
              </CardContent>
            </Card>
          ))}
        </div>

        <JobMonitor />
      </div>
    </FeaturePage>
  );
}
