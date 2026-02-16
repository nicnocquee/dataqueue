'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import {
  Home,
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
  LayoutDashboard,
  CalendarClock,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const featurePages = [
  { title: 'Overview', href: '/', icon: Home },
  { title: 'Add & Process Jobs', href: '/features/add-jobs', icon: Plus },
  { title: 'Tags & Filtering', href: '/features/tags', icon: Tags },
  { title: 'Job Management', href: '/features/management', icon: Settings },
  { title: 'Idempotency', href: '/features/idempotency', icon: Key },
  { title: 'Timeouts', href: '/features/timeouts', icon: Timer },
  { title: 'Waitpoints & Tokens', href: '/features/waitpoints', icon: Pause },
  { title: 'Step Memoization', href: '/features/steps', icon: Layers },
  { title: 'Job Events', href: '/features/events', icon: Activity },
  { title: 'Cron Schedules', href: '/features/cron', icon: CalendarClock },
  { title: 'Maintenance', href: '/features/maintenance', icon: Wrench },
  { title: 'React SDK', href: '/features/react-sdk', icon: Monitor },
  {
    title: 'Admin Dashboard',
    href: '/admin/dataqueue',
    icon: LayoutDashboard,
    external: true,
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            DQ
          </div>
          <div>
            <p className="font-semibold text-sm">Dataqueue</p>
            <p className="text-xs text-muted-foreground">Feature Demo</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Features</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {featurePages.map((page) => (
                <SidebarMenuItem key={page.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      page.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(page.href)
                    }
                  >
                    <Link
                      href={page.href}
                      {...(page.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      <page.icon className="h-4 w-4" />
                      <span>{page.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
