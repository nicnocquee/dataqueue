import { handleRequest } from './core/api-handlers.js';
import type { DashboardConfig } from './core/types.js';

export type { DashboardConfig } from './core/types.js';

type NextRouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

type NextRouteHandler = (
  request: Request,
  context: NextRouteContext,
) => Promise<Response>;

/**
 * Create a dataqueue dashboard handler for Next.js App Router.
 *
 * Usage:
 * ```ts
 * // app/admin/dataqueue/[[...path]]/route.ts
 * import { createDataqueueDashboard } from '@nicnocquee/dataqueue-dashboard/next'
 * import { getJobQueue, jobHandlers } from '@/lib/queue'
 *
 * const { GET, POST } = createDataqueueDashboard({
 *   jobQueue: getJobQueue(),
 *   jobHandlers,
 *   basePath: '/admin/dataqueue',
 * })
 *
 * export { GET, POST }
 * ```
 */
export function createDataqueueDashboard<PayloadMap = any>(
  config: DashboardConfig<PayloadMap>,
): { GET: NextRouteHandler; POST: NextRouteHandler } {
  const handler: NextRouteHandler = async (request) => {
    return handleRequest(request, config as DashboardConfig);
  };

  return {
    GET: handler,
    POST: handler,
  };
}
