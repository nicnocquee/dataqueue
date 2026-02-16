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
} from 'lucide-react';
import Link from 'next/link';

const features = [
  {
    title: 'Add & Process Jobs',
    description: 'Create jobs with all options and trigger processing',
    href: '/features/add-jobs',
    icon: Plus,
  },
  {
    title: 'Tags & Filtering',
    description: 'Tag jobs and filter by tags with different modes',
    href: '/features/tags',
    icon: Tags,
  },
  {
    title: 'Job Management',
    description: 'Retry, cancel, and edit individual jobs',
    href: '/features/management',
    icon: Settings,
  },
  {
    title: 'Idempotency',
    description: 'Prevent duplicate jobs with idempotency keys',
    href: '/features/idempotency',
    icon: Key,
  },
  {
    title: 'Timeouts',
    description: 'Timeout handling, prolong, onTimeout, force kill',
    href: '/features/timeouts',
    icon: Timer,
  },
  {
    title: 'Waitpoints & Tokens',
    description:
      'Pause jobs with waitFor/waitUntil and human-in-the-loop tokens',
    href: '/features/waitpoints',
    icon: Pause,
  },
  {
    title: 'Step Memoization',
    description: 'Multi-step jobs with ctx.run for durable execution',
    href: '/features/steps',
    icon: Layers,
  },
  {
    title: 'Job Events',
    description: 'View the full event history for any job',
    href: '/features/events',
    icon: Activity,
  },
  {
    title: 'Maintenance',
    description: 'Cleanup old jobs/events and reclaim stuck jobs',
    href: '/features/maintenance',
    icon: Wrench,
  },
  {
    title: 'React SDK',
    description: 'Track job status and progress in real time with useJob hook',
    href: '/features/react-sdk',
    icon: Monitor,
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
            <Link key={feature.href} href={feature.href}>
              <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <feature.icon className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm">{feature.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <JobMonitor />
      </div>
    </FeaturePage>
  );
}
