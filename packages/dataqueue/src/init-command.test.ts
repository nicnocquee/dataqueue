import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_ROUTER_ROUTE_TEMPLATE,
  CRON_SH_TEMPLATE,
  PAGES_ROUTER_ROUTE_TEMPLATE,
  QUEUE_TEMPLATE,
  detectNextJsAndRouter,
  runInit,
} from './init-command.js';

type VirtualFsState = {
  files: Map<string, string>;
  dirs: Set<string>;
  chmodCalls: Array<{ filePath: string; mode: number }>;
};

/**
 * Builds a fake filesystem API surface compatible with `InitDeps`.
 */
function createVirtualFs(
  cwd: string,
  initialFiles: Record<string, string> = {},
  initialDirs: string[] = [],
) {
  const state: VirtualFsState = {
    files: new Map(),
    dirs: new Set([cwd, ...initialDirs.map((dir) => resolvePath(cwd, dir))]),
    chmodCalls: [],
  };

  for (const [filePath, content] of Object.entries(initialFiles)) {
    const absolutePath = resolvePath(cwd, filePath);
    state.files.set(absolutePath, content);
    state.dirs.add(path.dirname(absolutePath));
  }

  return {
    state,
    existsSyncImpl: vi.fn((targetPath: string) => {
      return state.files.has(targetPath) || state.dirs.has(targetPath);
    }),
    mkdirSyncImpl: vi.fn((targetPath: string) => {
      state.dirs.add(targetPath);
    }),
    readFileSyncImpl: vi.fn((targetPath: string) => {
      const content = state.files.get(targetPath);
      if (typeof content !== 'string') {
        throw new Error(`ENOENT: ${targetPath}`);
      }
      return content;
    }),
    writeFileSyncImpl: vi.fn((targetPath: string, content: string) => {
      state.files.set(targetPath, content);
      state.dirs.add(path.dirname(targetPath));
    }),
    chmodSyncImpl: vi.fn((filePath: string, mode: number) => {
      state.chmodCalls.push({ filePath, mode });
    }),
  };
}

/**
 * Resolves a project-relative path to absolute for tests.
 */
function resolvePath(cwd: string, maybeRelativePath: string): string {
  if (path.isAbsolute(maybeRelativePath)) {
    return maybeRelativePath;
  }
  return path.join(cwd, maybeRelativePath);
}

describe('detectNextJsAndRouter', () => {
  const cwd = '/project';

  it('throws if package.json is missing', () => {
    const fs = createVirtualFs(cwd);
    expect(() =>
      detectNextJsAndRouter({
        cwd,
        existsSyncImpl: fs.existsSyncImpl as any,
        readFileSyncImpl: fs.readFileSyncImpl as any,
      }),
    ).toThrow('package.json not found in current directory.');
  });

  it('throws if next dependency is missing', () => {
    const fs = createVirtualFs(cwd, {
      'package.json': JSON.stringify({ name: 'app' }),
    });

    expect(() =>
      detectNextJsAndRouter({
        cwd,
        existsSyncImpl: fs.existsSyncImpl as any,
        readFileSyncImpl: fs.readFileSyncImpl as any,
      }),
    ).toThrow(
      "Not a Next.js project. Could not find 'next' in package.json dependencies.",
    );
  });

  it('detects app router when app exists', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          dependencies: { next: '15.0.0' },
        }),
      },
      ['app'],
    );

    const result = detectNextJsAndRouter({
      cwd,
      existsSyncImpl: fs.existsSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
    });

    expect(result.router).toBe('app');
    expect(result.srcRoot).toBe('.');
  });

  it('detects pages router when only pages exists', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          devDependencies: { next: '15.0.0' },
        }),
      },
      ['pages'],
    );

    const result = detectNextJsAndRouter({
      cwd,
      existsSyncImpl: fs.existsSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
    });

    expect(result.router).toBe('pages');
    expect(result.srcRoot).toBe('.');
  });

  it('prefers app router when both app and pages exist', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          dependencies: { next: '15.0.0' },
        }),
      },
      ['app', 'pages'],
    );

    const result = detectNextJsAndRouter({
      cwd,
      existsSyncImpl: fs.existsSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
    });

    expect(result.router).toBe('app');
  });

  it('uses src as root when src exists', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          dependencies: { next: '15.0.0' },
        }),
      },
      ['src', 'src/pages'],
    );

    const result = detectNextJsAndRouter({
      cwd,
      existsSyncImpl: fs.existsSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
    });

    expect(result.srcRoot).toBe('src');
    expect(result.router).toBe('pages');
  });

  it('throws when neither app nor pages exists', () => {
    const fs = createVirtualFs(cwd, {
      'package.json': JSON.stringify({
        dependencies: { next: '15.0.0' },
      }),
    });

    expect(() =>
      detectNextJsAndRouter({
        cwd,
        existsSyncImpl: fs.existsSyncImpl as any,
        readFileSyncImpl: fs.readFileSyncImpl as any,
      }),
    ).toThrow(
      'Could not detect Next.js router. Expected either app/ or pages/ directory.',
    );
  });
});

describe('runInit', () => {
  const cwd = '/project';
  let log: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    log = vi.fn();
    error = vi.fn();
    exit = vi.fn();
  });

  it('creates app router files, updates package.json, and exits successfully', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          name: 'app',
          dependencies: { next: '15.0.0' },
        }),
      },
      ['app'],
    );

    runInit({
      cwd,
      log,
      error,
      exit,
      existsSyncImpl: fs.existsSyncImpl as any,
      mkdirSyncImpl: fs.mkdirSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
      writeFileSyncImpl: fs.writeFileSyncImpl as any,
      chmodSyncImpl: fs.chmodSyncImpl as any,
    });

    expect(
      fs.state.files.get(
        resolvePath(cwd, 'app/api/dataqueue/manage/[[...task]]/route.ts'),
      ),
    ).toBe(APP_ROUTER_ROUTE_TEMPLATE);
    expect(fs.state.files.get(resolvePath(cwd, 'lib/dataqueue/queue.ts'))).toBe(
      QUEUE_TEMPLATE,
    );
    expect(fs.state.files.get(resolvePath(cwd, 'cron.sh'))).toBe(
      CRON_SH_TEMPLATE,
    );
    expect(fs.state.chmodCalls).toEqual([
      { filePath: resolvePath(cwd, 'cron.sh'), mode: 0o755 },
    ]);

    const updatedPackageJson = JSON.parse(
      fs.state.files.get(resolvePath(cwd, 'package.json')) || '{}',
    );
    expect(updatedPackageJson.dependencies['@nicnocquee/dataqueue']).toBe(
      'latest',
    );
    expect(
      updatedPackageJson.dependencies['@nicnocquee/dataqueue-dashboard'],
    ).toBe('latest');
    expect(updatedPackageJson.dependencies['@nicnocquee/dataqueue-react']).toBe(
      'latest',
    );
    expect(updatedPackageJson.devDependencies['dotenv-cli']).toBe('latest');
    expect(updatedPackageJson.devDependencies['ts-node']).toBe('latest');
    expect(updatedPackageJson.devDependencies['node-pg-migrate']).toBe(
      'latest',
    );
    expect(updatedPackageJson.scripts.cron).toBe('bash cron.sh');
    expect(updatedPackageJson.scripts['migrate-dataqueue']).toBe(
      'dotenv -e .env.local -- dataqueue-cli migrate',
    );

    expect(log).toHaveBeenCalledWith(
      '  [skipped] pages/api/dataqueue/manage/[[...task]].ts (router not selected)',
    );
    expect(log).toHaveBeenCalledWith(
      "Done! Run your package manager's install command to install new dependencies.",
    );
    expect(error).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('creates pages router file when only pages router exists', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          name: 'app',
          dependencies: { next: '15.0.0' },
        }),
      },
      ['pages'],
    );

    runInit({
      cwd,
      log,
      error,
      exit,
      existsSyncImpl: fs.existsSyncImpl as any,
      mkdirSyncImpl: fs.mkdirSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
      writeFileSyncImpl: fs.writeFileSyncImpl as any,
      chmodSyncImpl: fs.chmodSyncImpl as any,
    });

    expect(
      fs.state.files.get(
        resolvePath(cwd, 'pages/api/dataqueue/manage/[[...task]].ts'),
      ),
    ).toBe(PAGES_ROUTER_ROUTE_TEMPLATE);
    expect(log).toHaveBeenCalledWith(
      '  [skipped] app/api/dataqueue/manage/[[...task]]/route.ts (router not selected)',
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('skips existing files and existing package entries', () => {
    const existingRoute = '/* existing */';
    const existingCron = '#!/bin/bash\n# existing';
    const existingQueue = '// existing queue';
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': JSON.stringify({
          dependencies: {
            next: '15.0.0',
            '@nicnocquee/dataqueue': '^1.0.0',
          },
          devDependencies: {
            'dotenv-cli': '^8.0.0',
          },
          scripts: {
            cron: 'bash cron.sh',
          },
        }),
        'app/api/dataqueue/manage/[[...task]]/route.ts': existingRoute,
        'cron.sh': existingCron,
        'lib/dataqueue/queue.ts': existingQueue,
      },
      ['app'],
    );

    runInit({
      cwd,
      log,
      error,
      exit,
      existsSyncImpl: fs.existsSyncImpl as any,
      mkdirSyncImpl: fs.mkdirSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
      writeFileSyncImpl: fs.writeFileSyncImpl as any,
      chmodSyncImpl: fs.chmodSyncImpl as any,
    });

    expect(
      fs.state.files.get(
        resolvePath(cwd, 'app/api/dataqueue/manage/[[...task]]/route.ts'),
      ),
    ).toBe(existingRoute);
    expect(fs.state.files.get(resolvePath(cwd, 'cron.sh'))).toBe(existingCron);
    expect(fs.state.files.get(resolvePath(cwd, 'lib/dataqueue/queue.ts'))).toBe(
      existingQueue,
    );

    const updatedPackageJson = JSON.parse(
      fs.state.files.get(resolvePath(cwd, 'package.json')) || '{}',
    );
    expect(updatedPackageJson.dependencies['@nicnocquee/dataqueue']).toBe(
      '^1.0.0',
    );
    expect(updatedPackageJson.scripts.cron).toBe('bash cron.sh');
    expect(updatedPackageJson.scripts['migrate-dataqueue']).toBe(
      'dotenv -e .env.local -- dataqueue-cli migrate',
    );
    expect(log).toHaveBeenCalledWith(
      '  [skipped] dependency @nicnocquee/dataqueue (already exists)',
    );
    expect(log).toHaveBeenCalledWith(
      '  [skipped] script "cron" (already exists)',
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('works for a monorepo sub-app by using cwd package.json', () => {
    const subAppCwd = '/repo/apps/web';
    const fs = createVirtualFs(
      subAppCwd,
      {
        'package.json': JSON.stringify({
          dependencies: { next: '15.0.0' },
        }),
      },
      ['app'],
    );

    runInit({
      cwd: subAppCwd,
      log,
      error,
      exit,
      existsSyncImpl: fs.existsSyncImpl as any,
      mkdirSyncImpl: fs.mkdirSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
      writeFileSyncImpl: fs.writeFileSyncImpl as any,
      chmodSyncImpl: fs.chmodSyncImpl as any,
    });

    expect(
      fs.state.files.has(
        resolvePath(subAppCwd, 'app/api/dataqueue/manage/[[...task]]/route.ts'),
      ),
    ).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('logs an error and exits with code 1 for invalid package.json', () => {
    const fs = createVirtualFs(
      cwd,
      {
        'package.json': '{invalid json',
      },
      ['app'],
    );

    runInit({
      cwd,
      log,
      error,
      exit,
      existsSyncImpl: fs.existsSyncImpl as any,
      mkdirSyncImpl: fs.mkdirSyncImpl as any,
      readFileSyncImpl: fs.readFileSyncImpl as any,
      writeFileSyncImpl: fs.writeFileSyncImpl as any,
      chmodSyncImpl: fs.chmodSyncImpl as any,
    });

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(
      'Failed to parse package.json',
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
