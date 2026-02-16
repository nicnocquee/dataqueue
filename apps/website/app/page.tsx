'use client';

import { useState, useEffect } from 'react';
import {
  Moon,
  Sun,
  Github,
  ArrowRight,
  Code,
  Zap,
  Shield,
  Server,
  Clock,
  Database,
  CheckCircle,
  Timer,
  Atom,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';

const FeatureCard = ({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) => {
  return (
    <Card className="group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:bg-card/80 hover:shadow-lg hover:shadow-purple-500/10">
      <CardContent className="p-6">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 text-white">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="mb-2 text-xl font-semibold text-foreground">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

const BenefitCard = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border/50 bg-card/30 p-6 backdrop-blur-sm transition-all duration-300 hover:bg-card/50 hover:shadow-lg">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-orange-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative">
        <div className="mb-3 flex items-center">
          <CheckCircle className="mr-3 h-5 w-5 text-green-500" />
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
};

export default function HomePage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const codeExample = `import { DataQueue } from '@dataqueue/core';

// Define your job types with strong typing
interface EmailJob {
  to: string;
  subject: string;
  body: string;
}

// Initialize the queue
const queue = new DataQueue(connectionString);

// Add a job with type safety
await queue.add<EmailJob>('email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up!'
});

// Process jobs with automatic retry logic
queue.process<EmailJob>('email', async (job) => {
  await sendEmail(job.payload);
});`;

  const features = [
    {
      icon: Code,
      title: 'Simple API',
      description:
        'Clean, intuitive API that gets you up and running in minutes. No complex configurations or steep learning curves.',
    },
    {
      icon: Shield,
      title: 'Type Safety',
      description:
        'Full TypeScript support with strong typing for job payloads. Catch errors at compile time, not runtime.',
    },
    {
      icon: Zap,
      title: 'Serverless Ready',
      description:
        'Designed from the ground up to work perfectly with serverless platforms like Vercel and AWS Lambda.',
    },
    {
      icon: Server,
      title: 'PostgreSQL or Redis',
      description:
        'Choose the backend that fits your stack. Same API, full feature parity — just change a config option.',
    },
    {
      icon: Clock,
      title: 'Advanced Scheduling',
      description:
        'Support for job priorities, delays, retries, and automatic cleanup of old jobs.',
    },
    {
      icon: Database,
      title: 'Reliable Processing',
      description:
        'Built-in job recovery and stuck job handling ensures no jobs are lost or forgotten.',
    },
    {
      icon: Timer,
      title: 'Smart Waits',
      description:
        'Pause and resume job execution with time-based delays or external signals. Build multi-step workflows like onboarding sequences and approval flows as a single handler.',
    },
    {
      icon: Atom,
      title: 'React Hooks',
      description:
        'Subscribe to job status and progress updates from React components with a single hook. Automatic polling stops when jobs complete — zero extra configuration.',
    },
    {
      icon: LayoutDashboard,
      title: 'Admin Dashboard',
      description:
        'Add a complete admin dashboard to your Next.js app with a single route file. View, inspect, and manage jobs without building custom UI.',
    },
  ];

  const benefits = [
    {
      title: 'Serverless Deployment',
      description:
        'Perfect for Vercel, AWS Lambda, and other serverless platforms',
    },
    {
      title: 'TypeScript First',
      description:
        'Built with TypeScript developers in mind with full type safety',
    },
    {
      title: 'Fast & Responsive',
      description: 'Offload heavy tasks to keep your app lightning fast',
    },
    {
      title: 'PostgreSQL or Redis',
      description:
        'Works with your existing database — no additional services needed',
    },
    {
      title: 'Budget Friendly',
      description: 'No separate queue service costs or server maintenance',
    },
    {
      title: 'Simple Migration',
      description:
        'Easy to integrate into existing Node.js and TypeScript projects',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center space-x-2">
            <Image
              src="/dataqueue-logo.png"
              alt="DataQueue Logo"
              width={32}
              height={32}
              className="size-6"
            />
            <span className="text-xl font-bold text-foreground">DataQueue</span>
          </div>
          <nav className="hidden space-x-8 md:flex">
            <a
              href="#features"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Features
            </a>

            <a
              href="#who"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Who It's For
            </a>
            <a
              href="https://docs.dataqueue.dev"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Docs
            </a>
          </nav>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === 'light' ? (
                <Moon className="h-5 w-5" />
              ) : (
                <Sun className="h-5 w-5" />
              )}
            </Button>
            <Button variant="outline" asChild>
              <a
                href="https://github.com/nicnocquee/dataqueue"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="mr-2 h-4 w-4" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-background to-orange-500/10" />
        <div className="container relative mx-auto px-4 text-center">
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Handle{' '}
              <span className="bg-gradient-to-r from-purple-500 to-orange-500 bg-clip-text text-transparent">
                background jobs
              </span>{' '}
              with ease
            </h1>
            <p className="mb-8 text-xl text-muted-foreground sm:text-2xl">
              A lightweight job queue backed by{' '}
              <span className="font-semibold text-foreground">PostgreSQL</span>{' '}
              or <span className="font-semibold text-foreground">Redis</span>.
              Use your existing database — no extra infra needed.{' '}
              <span className="highlight-marker">Open Source.</span>
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="https://docs.dataqueue.dev/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-purple-500 to-orange-500 text-white hover:from-purple-600 hover:to-orange-600"
                >
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      {/* <section id="examples" className="py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-4 text-center text-3xl font-bold text-foreground">
              Simple to Use
            </h2>
            <p className="mb-12 text-center text-lg text-muted-foreground">
              Get started in minutes with our intuitive API and strong
              TypeScript support
            </p>
            <CodeBlock className="mx-auto max-w-3xl">{codeExample}</CodeBlock>
          </div>
        </div>
      </section> */}

      {/* Features */}
      <section id="features" className="py-20">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground">
              Powerful Features
            </h2>
            <p className="text-lg text-muted-foreground">
              Everything you need for reliable background job processing
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <FeatureCard key={index} {...feature} />
            ))}
          </div>
        </div>
      </section>

      {/* Who It's For */}
      <section id="who" className="py-20">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground">
              Perfect For
            </h2>
            <p className="text-lg text-muted-foreground">
              Built specifically for modern TypeScript developers
            </p>
          </div>
          <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
            {benefits.map((benefit, index) => (
              <BenefitCard key={index} {...benefit} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-500/10 to-orange-500/10 p-12 text-center backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-orange-500/5" />
            <div className="relative">
              <h2 className="mb-4 text-3xl font-bold text-foreground">
                Ready to Get Started?
              </h2>
              <p className="mb-8 text-lg text-muted-foreground">
                Join developers who are already using DataQueue to build faster,
                more reliable applications.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <a
                  href="https://github.com/nicnocquee/dataqueue"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-purple-500 to-orange-500 text-white hover:from-purple-600 hover:to-orange-600"
                  >
                    <Github className="mr-2 h-5 w-5" />
                    Star on GitHub
                  </Button>
                </a>
                <a
                  href="https://docs.dataqueue.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="lg" variant="outline">
                    Read the Docs
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center space-x-2">
              <Image
                src="/dataqueue-logo.png"
                alt="DataQueue Logo"
                width={32}
                height={32}
                className="size-6"
              />
              <span className="font-semibold text-foreground">DataQueue</span>
            </div>
            <p className="text-muted-foreground">
              Made in Switzerland by{' '}
              <a className="text-primary" href="https://nico.fyi">
                Nico Prananta
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
