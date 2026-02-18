import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';

type JsonObject = Record<string, unknown>;
type JsonMap = Record<string, string>;

const DEPENDENCIES_TO_ADD = [
  '@nicnocquee/dataqueue',
  '@nicnocquee/dataqueue-dashboard',
  '@nicnocquee/dataqueue-react',
] as const;

const DEV_DEPENDENCIES_TO_ADD = [
  'dotenv-cli',
  'ts-node',
  'node-pg-migrate',
] as const;

const SCRIPTS_TO_ADD = {
  cron: 'bash cron.sh',
  'migrate-dataqueue': 'dotenv -e .env.local -- dataqueue-cli migrate',
} as const;

/**
 * App router endpoint template for queue management.
 */
export const APP_ROUTER_ROUTE_TEMPLATE = `/**
 * This end point is used to manage the job queue.
 * It supports the following tasks:
 * - reclaim: Reclaim stuck jobs
 * - cleanup: Cleanup old jobs
 * - process: Process jobs
 *
 * Example usage with default values (reclaim stuck jobs for 10 minutes, cleanup old jobs for 30 days, and process jobs with batch size 3, concurrency 2, and verbose true):
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET"
 *
 * Example usage with custom values:
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET" -d '{"maxProcessingTimeMinutes": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET" -d '{"daysToKeep": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET" -d '{"batchSize": 5, "concurrency": 3, "verbose": false, "workerId": "custom-worker-id"}' -H "Content-Type: application/json"
 *
 * During development, you can run the following script to run the cron jobs continuously in the background:
 * pnpm cron
 */
import { getJobQueue, jobHandlers } from '@/lib/dataqueue/queue';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ task: string[] }> },
) {
  const { task } = await params;
  const authHeader = request.headers.get('authorization');
  if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  if (!task || task.length === 0) {
    return NextResponse.json({ message: 'Task is required' }, { status: 400 });
  }

  const supportedTasks = ['reclaim', 'cleanup', 'process'];
  const theTask = task[0];
  if (!supportedTasks.includes(theTask)) {
    return NextResponse.json(
      { message: 'Task not supported' },
      { status: 400 },
    );
  }

  try {
    const jobQueue = getJobQueue();

    if (theTask === 'reclaim') {
      let maxProcessingTimeMinutes = 10;
      try {
        const body = await request.json();
        maxProcessingTimeMinutes = body.maxProcessingTimeMinutes || 10;
      } catch {
        // ignore parsing error and use default value
      }
      const reclaimed = await jobQueue.reclaimStuckJobs(
        maxProcessingTimeMinutes,
      );
      console.log(\`Reclaimed \${reclaimed} stuck jobs\`);
      return NextResponse.json({
        message: \`Stuck jobs reclaimed: \${reclaimed} with maxProcessingTimeMinutes: \${maxProcessingTimeMinutes}\`,
        reclaimed,
      });
    }

    if (theTask === 'cleanup') {
      let daysToKeep = 30;
      try {
        const body = await request.json();
        daysToKeep = body.daysToKeep || 30;
      } catch {
        // ignore parsing error and use default value
      }
      const deleted = await jobQueue.cleanupOldJobs(daysToKeep);
      console.log(\`Deleted \${deleted} old jobs\`);
      return NextResponse.json({
        message: \`Old jobs cleaned up: \${deleted} with daysToKeep: \${daysToKeep}\`,
        deleted,
      });
    }

    if (theTask === 'process') {
      let batchSize = 3;
      let concurrency = 2;
      let verbose = true;
      let workerId = \`manage-\${theTask}-\${Date.now()}\`;
      try {
        const body = await request.json();
        batchSize = body.batchSize || 3;
        concurrency = body.concurrency || 2;
        verbose = body.verbose || true;
        workerId = body.workerId || \`manage-\${theTask}-\${Date.now()}\`;
      } catch {
        // ignore parsing error and use default value
      }
      const processor = jobQueue.createProcessor(jobHandlers, {
        workerId,
        batchSize,
        concurrency,
        verbose,
      });
      const processed = await processor.start();

      return NextResponse.json({
        message: \`Jobs processed: \${processed} with workerId: \${workerId}, batchSize: \${batchSize}, concurrency: \${concurrency}, and verbose: \${verbose}\`,
        processed,
      });
    }

    return NextResponse.json(
      { message: 'Task not supported' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Error processing jobs:', error);
    return NextResponse.json(
      { message: 'Failed to process jobs' },
      { status: 500 },
    );
  }
}
`;

/**
 * Pages router endpoint template for queue management.
 */
export const PAGES_ROUTER_ROUTE_TEMPLATE = `/**
 * This end point is used to manage the job queue.
 * It supports the following tasks:
 * - reclaim: Reclaim stuck jobs
 * - cleanup: Cleanup old jobs
 * - process: Process jobs
 *
 * Example usage with default values (reclaim stuck jobs for 10 minutes, cleanup old jobs for 30 days, and process jobs with batch size 3, concurrency 2, and verbose true):
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET"
 *
 * Example usage with custom values:
 * curl -X POST http://localhost:3000/api/dataqueue/manage/reclaim -H "Authorization: Bearer $CRON_SECRET" -d '{"maxProcessingTimeMinutes": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/cleanup -H "Authorization: Bearer $CRON_SECRET" -d '{"daysToKeep": 15}' -H "Content-Type: application/json"
 * curl -X POST http://localhost:3000/api/dataqueue/manage/process -H "Authorization: Bearer $CRON_SECRET" -d '{"batchSize": 5, "concurrency": 3, "verbose": false, "workerId": "custom-worker-id"}' -H "Content-Type: application/json"
 *
 * During development, you can run the following script to run the cron jobs continuously in the background:
 * pnpm cron
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getJobQueue, jobHandlers } from '@/lib/dataqueue/queue';

type ResponseBody = {
  message: string;
  reclaimed?: number;
  deleted?: number;
  processed?: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const task = req.query.task;
  const taskArray = Array.isArray(task) ? task : task ? [task] : [];
  if (!taskArray.length) {
    return res.status(400).json({ message: 'Task is required' });
  }

  const supportedTasks = ['reclaim', 'cleanup', 'process'];
  const theTask = taskArray[0];
  if (!supportedTasks.includes(theTask)) {
    return res.status(400).json({ message: 'Task not supported' });
  }

  try {
    const jobQueue = getJobQueue();
    const body = typeof req.body === 'object' && req.body ? req.body : {};

    if (theTask === 'reclaim') {
      const maxProcessingTimeMinutes = body.maxProcessingTimeMinutes || 10;
      const reclaimed = await jobQueue.reclaimStuckJobs(maxProcessingTimeMinutes);
      console.log(\`Reclaimed \${reclaimed} stuck jobs\`);
      return res.status(200).json({
        message: \`Stuck jobs reclaimed: \${reclaimed} with maxProcessingTimeMinutes: \${maxProcessingTimeMinutes}\`,
        reclaimed,
      });
    }

    if (theTask === 'cleanup') {
      const daysToKeep = body.daysToKeep || 30;
      const deleted = await jobQueue.cleanupOldJobs(daysToKeep);
      console.log(\`Deleted \${deleted} old jobs\`);
      return res.status(200).json({
        message: \`Old jobs cleaned up: \${deleted} with daysToKeep: \${daysToKeep}\`,
        deleted,
      });
    }

    const batchSize = body.batchSize || 3;
    const concurrency = body.concurrency || 2;
    const verbose = body.verbose || true;
    const workerId = body.workerId || \`manage-\${theTask}-\${Date.now()}\`;
    const processor = jobQueue.createProcessor(jobHandlers, {
      workerId,
      batchSize,
      concurrency,
      verbose,
    });
    const processed = await processor.start();

    return res.status(200).json({
      message: \`Jobs processed: \${processed} with workerId: \${workerId}, batchSize: \${batchSize}, concurrency: \${concurrency}, and verbose: \${verbose}\`,
      processed,
    });
  } catch (error) {
    console.error('Error processing jobs:', error);
    return res.status(500).json({ message: 'Failed to process jobs' });
  }
}
`;

/**
 * Cron script template for local queue processing.
 */
export const CRON_SH_TEMPLATE = `#!/bin/bash

# This script is used to run the cron jobs for the demo app during development.
# Run it with \`pnpm cron\` from the apps/demo directory.

set -a
source "$(dirname "$0")/.env.local"
set +a

if [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_SECRET environment variable is not set in .env.local"
  exit 1
fi

cleanup() {
  kill 0
  wait
}
trap cleanup SIGINT SIGTERM

while true; do
  echo "Processing jobs..."
  curl http://localhost:3000/api/dataqueue/manage/process -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 10 # Process jobs every 10 seconds
done &

while true; do
  echo "Reclaiming stuck jobs..."
  curl http://localhost:3000/api/dataqueue/manage/reclaim -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 20 # Reclaim stuck jobs every 20 seconds
done &

while true; do
  echo "Cleaning up old jobs..."
  curl http://localhost:3000/api/dataqueue/manage/cleanup -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 30 # Cleanup old jobs every 30 seconds
done &

wait
`;

/**
 * Queue placeholder template with a single `send_email` job.
 */
export const QUEUE_TEMPLATE = `import { initJobQueue, JobHandlers } from '@nicnocquee/dataqueue';

export type JobPayloadMap = {
  send_email: {
    to: string;
    subject: string;
    body: string;
  };
};

let jobQueue: ReturnType<typeof initJobQueue<JobPayloadMap>> | null = null;

export const getJobQueue = () => {
  if (!jobQueue) {
    jobQueue = initJobQueue<JobPayloadMap>({
      databaseConfig: {
        connectionString: process.env.PG_DATAQUEUE_DATABASE,
      },
      verbose: process.env.NODE_ENV === 'development',
    });
  }
  return jobQueue;
};

export const jobHandlers: JobHandlers<JobPayloadMap> = {
  send_email: async (payload) => {
    const { to, subject, body } = payload;
    console.log('send_email placeholder:', { to, subject, body });
  },
};
`;

export interface InitDeps {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  exit?: (code: number) => void;
  cwd?: string;
  readFileSyncImpl?: typeof readFileSync;
  writeFileSyncImpl?: typeof writeFileSync;
  existsSyncImpl?: typeof existsSync;
  mkdirSyncImpl?: typeof mkdirSync;
  chmodSyncImpl?: typeof chmodSync;
}

type RouterKind = 'app' | 'pages';

interface ProjectDetails {
  cwd: string;
  packageJsonPath: string;
  packageJson: JsonObject;
  srcRoot: string;
  router: RouterKind;
}

/**
 * Runs the `dataqueue-cli init` command.
 */
export function runInit({
  log = console.log,
  error = console.error,
  exit = (code: number) => process.exit(code),
  cwd = process.cwd(),
  readFileSyncImpl = readFileSync,
  writeFileSyncImpl = writeFileSync,
  existsSyncImpl = existsSync,
  mkdirSyncImpl = mkdirSync,
  chmodSyncImpl = chmodSync,
}: InitDeps = {}): void {
  try {
    log(`dataqueue: Initializing in ${cwd}...`);
    log('');

    const details = detectNextJsAndRouter({
      cwd,
      existsSyncImpl,
      readFileSyncImpl,
    });

    createScaffoldFiles({
      details,
      log,
      existsSyncImpl,
      mkdirSyncImpl,
      writeFileSyncImpl,
      chmodSyncImpl,
    });

    updatePackageJson({
      details,
      log,
      writeFileSyncImpl,
    });

    log('');
    log(
      "Done! Run your package manager's install command to install new dependencies.",
    );
    exit(0);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    error(`dataqueue: ${message}`);
    exit(1);
  }
}

/**
 * Detects that the current directory is a Next.js app and chooses the router.
 */
export function detectNextJsAndRouter({
  cwd,
  existsSyncImpl,
  readFileSyncImpl,
}: {
  cwd: string;
  existsSyncImpl: typeof existsSync;
  readFileSyncImpl: typeof readFileSync;
}): ProjectDetails {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!existsSyncImpl(packageJsonPath)) {
    throw new Error('package.json not found in current directory.');
  }

  const packageJson = parsePackageJson(
    readFileSyncImpl(packageJsonPath, 'utf8'),
    packageJsonPath,
  );
  if (!isNextJsProject(packageJson)) {
    throw new Error(
      "Not a Next.js project. Could not find 'next' in package.json dependencies.",
    );
  }

  const srcDir = path.join(cwd, 'src');
  const srcRoot = existsSyncImpl(srcDir) ? 'src' : '.';
  const appDir = path.join(cwd, srcRoot, 'app');
  const pagesDir = path.join(cwd, srcRoot, 'pages');
  const hasAppDir = existsSyncImpl(appDir);
  const hasPagesDir = existsSyncImpl(pagesDir);

  if (!hasAppDir && !hasPagesDir) {
    throw new Error(
      'Could not detect Next.js router. Expected either app/ or pages/ directory.',
    );
  }

  const router: RouterKind = hasAppDir ? 'app' : 'pages';
  return { cwd, packageJsonPath, packageJson, srcRoot, router };
}

/**
 * Updates package.json with required dependencies and scripts.
 */
function updatePackageJson({
  details,
  log,
  writeFileSyncImpl,
}: {
  details: ProjectDetails;
  log: (...args: any[]) => void;
  writeFileSyncImpl: typeof writeFileSync;
}): void {
  const packageJson = details.packageJson;
  const dependencies = ensureStringMapSection(packageJson, 'dependencies');
  const devDependencies = ensureStringMapSection(
    packageJson,
    'devDependencies',
  );
  const scripts = ensureStringMapSection(packageJson, 'scripts');

  for (const dependency of DEPENDENCIES_TO_ADD) {
    if (dependencies[dependency]) {
      log(`  [skipped] dependency ${dependency} (already exists)`);
      continue;
    }
    dependencies[dependency] = 'latest';
    log(`  [added]   dependency ${dependency}`);
  }

  for (const devDependency of DEV_DEPENDENCIES_TO_ADD) {
    if (devDependencies[devDependency]) {
      log(`  [skipped] devDependency ${devDependency} (already exists)`);
      continue;
    }
    devDependencies[devDependency] = 'latest';
    log(`  [added]   devDependency ${devDependency}`);
  }

  for (const [scriptName, scriptValue] of Object.entries(SCRIPTS_TO_ADD)) {
    if (scripts[scriptName]) {
      log(`  [skipped] script "${scriptName}" (already exists)`);
      continue;
    }
    scripts[scriptName] = scriptValue;
    log(`  [added]   script "${scriptName}"`);
  }

  writeFileSyncImpl(
    details.packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

/**
 * Creates all scaffold files for the detected router without overwriting.
 */
function createScaffoldFiles({
  details,
  log,
  existsSyncImpl,
  mkdirSyncImpl,
  writeFileSyncImpl,
  chmodSyncImpl,
}: {
  details: ProjectDetails;
  log: (...args: any[]) => void;
  existsSyncImpl: typeof existsSync;
  mkdirSyncImpl: typeof mkdirSync;
  writeFileSyncImpl: typeof writeFileSync;
  chmodSyncImpl: typeof chmodSync;
}): void {
  const appRoutePath = path.join(
    details.cwd,
    details.srcRoot,
    'app',
    'api',
    'dataqueue',
    'manage',
    '[[...task]]',
    'route.ts',
  );
  const pagesRoutePath = path.join(
    details.cwd,
    details.srcRoot,
    'pages',
    'api',
    'dataqueue',
    'manage',
    '[[...task]].ts',
  );
  const queuePath = path.join(
    details.cwd,
    details.srcRoot,
    'lib',
    'dataqueue',
    'queue.ts',
  );
  const cronPath = path.join(details.cwd, 'cron.sh');

  if (details.router === 'app') {
    createFileIfMissing({
      absolutePath: appRoutePath,
      content: APP_ROUTER_ROUTE_TEMPLATE,
      existsSyncImpl,
      mkdirSyncImpl,
      writeFileSyncImpl,
      log,
      logPath: toRelativePath(details.cwd, appRoutePath),
    });
    log(
      '  [skipped] pages/api/dataqueue/manage/[[...task]].ts (router not selected)',
    );
  } else {
    log(
      '  [skipped] app/api/dataqueue/manage/[[...task]]/route.ts (router not selected)',
    );
    createFileIfMissing({
      absolutePath: pagesRoutePath,
      content: PAGES_ROUTER_ROUTE_TEMPLATE,
      existsSyncImpl,
      mkdirSyncImpl,
      writeFileSyncImpl,
      log,
      logPath: toRelativePath(details.cwd, pagesRoutePath),
    });
  }

  createFileIfMissing({
    absolutePath: cronPath,
    content: CRON_SH_TEMPLATE,
    existsSyncImpl,
    mkdirSyncImpl,
    writeFileSyncImpl,
    log,
    logPath: 'cron.sh',
  });
  if (existsSyncImpl(cronPath)) {
    chmodSyncImpl(cronPath, 0o755);
  }

  createFileIfMissing({
    absolutePath: queuePath,
    content: QUEUE_TEMPLATE,
    existsSyncImpl,
    mkdirSyncImpl,
    writeFileSyncImpl,
    log,
    logPath: toRelativePath(details.cwd, queuePath),
  });
}

/**
 * Creates a file only if it does not already exist.
 */
function createFileIfMissing({
  absolutePath,
  content,
  existsSyncImpl,
  mkdirSyncImpl,
  writeFileSyncImpl,
  log,
  logPath,
}: {
  absolutePath: string;
  content: string;
  existsSyncImpl: typeof existsSync;
  mkdirSyncImpl: typeof mkdirSync;
  writeFileSyncImpl: typeof writeFileSync;
  log: (...args: any[]) => void;
  logPath: string;
}): void {
  if (existsSyncImpl(absolutePath)) {
    log(`  [skipped] ${logPath} (already exists)`);
    return;
  }

  mkdirSyncImpl(path.dirname(absolutePath), { recursive: true });
  writeFileSyncImpl(absolutePath, content);
  log(`  [created] ${logPath}`);
}

/**
 * Parses package.json content with clear source context.
 */
function parsePackageJson(content: string, filePath: string): JsonObject {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('package.json must contain an object.');
    }
    return parsed as JsonObject;
  } catch (cause) {
    throw new Error(
      `Failed to parse package.json at ${filePath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

/**
 * Returns true when package.json declares Next.js in deps or devDeps.
 */
function isNextJsProject(packageJson: JsonObject): boolean {
  const dependencies = packageJson.dependencies;
  const devDependencies = packageJson.devDependencies;

  return (
    hasPackage(dependencies, 'next') || hasPackage(devDependencies, 'next')
  );
}

/**
 * Returns true when a package name exists in a dependency section object.
 */
function hasPackage(section: unknown, packageName: string): boolean {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return false;
  }
  return Boolean((section as JsonMap)[packageName]);
}

/**
 * Ensures package.json has a string map section and returns it.
 */
function ensureStringMapSection(
  packageJson: JsonObject,
  sectionName: 'dependencies' | 'devDependencies' | 'scripts',
): JsonMap {
  const currentValue = packageJson[sectionName];
  if (
    !currentValue ||
    typeof currentValue !== 'object' ||
    Array.isArray(currentValue)
  ) {
    packageJson[sectionName] = {};
  }
  return packageJson[sectionName] as JsonMap;
}

/**
 * Converts an absolute path to a stable relative path for log output.
 */
function toRelativePath(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath);
  return relative || '.';
}
