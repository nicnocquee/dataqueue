import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCli, CliDeps } from './cli.js';
import type { SpawnSyncReturns } from 'child_process';

function makeSpawnSyncReturns(status: number): SpawnSyncReturns<string> {
  // Provide all required properties for the mock
  return {
    pid: 123,
    output: [],
    stdout: '',
    stderr: '',
    status,
    signal: null,
    error: undefined,
  };
}

function makeDeps() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
    spawnSyncImpl: vi.fn(() => makeSpawnSyncReturns(0)),
    migrationsDir: '/migrations',
    runInitImpl: vi.fn(),
    runInstallSkillsImpl: vi.fn(),
    runInstallRulesImpl: vi.fn(async () => {}),
    runInstallMcpImpl: vi.fn(async () => {}),
    startMcpServerImpl: vi.fn(async () => ({}) as any),
  } satisfies CliDeps;
}

describe('runCli', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('prints usage and exits with code 1 for no command', () => {
    runCli(['node', 'cli.js'], deps);
    expect(deps.log).toHaveBeenCalledWith('Usage:');
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli init');
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('prints usage and exits with code 1 for unknown command', () => {
    runCli(['node', 'cli.js', 'unknown'], deps);
    expect(deps.log).toHaveBeenCalledWith('Usage:');
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli init');
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('routes init command to runInitImpl', () => {
    runCli(['node', 'cli.js', 'init'], deps);
    expect(deps.runInitImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        log: deps.log,
        error: deps.error,
        exit: deps.exit,
      }),
    );
    expect(deps.spawnSyncImpl).not.toHaveBeenCalled();
  });

  it('calls spawnSyncImpl with correct args for migrate', () => {
    runCli(['node', 'cli.js', 'migrate'], deps);
    expect(deps.spawnSyncImpl).toHaveBeenCalledWith(
      'npx',
      [
        'node-pg-migrate',
        'up',
        '-t',
        'dataqueuedev_migrations',
        '-d',
        'PG_DATAQUEUE_DATABASE',
        '-m',
        '/migrations',
      ],
      { stdio: 'inherit' },
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('parses -s schema argument and passes to spawnSyncImpl', () => {
    runCli(['node', 'cli.js', 'migrate', '-s', 'myschema'], deps);
    expect(deps.spawnSyncImpl).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['-s', 'myschema', '--create-schema']),
      expect.anything(),
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('parses --schema argument and passes to spawnSyncImpl', () => {
    runCli(['node', 'cli.js', 'migrate', '--schema', 'myschema'], deps);
    expect(deps.spawnSyncImpl).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['-s', 'myschema', '--create-schema']),
      expect.anything(),
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('parses --envPath argument and passes to spawnSyncImpl', () => {
    runCli(['node', 'cli.js', 'migrate', '--envPath', '.env.local'], deps);
    expect(deps.spawnSyncImpl).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['--envPath', '.env.local']),
      expect.anything(),
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('passes extra args to spawnSyncImpl', () => {
    runCli(['node', 'cli.js', 'migrate', '--foo', 'bar'], deps);
    expect(deps.spawnSyncImpl).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['--foo', 'bar']),
      expect.anything(),
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('exits with nonzero code if spawnSyncImpl returns nonzero status', () => {
    deps.spawnSyncImpl.mockReturnValueOnce(makeSpawnSyncReturns(2));
    runCli(['node', 'cli.js', 'migrate'], deps);
    expect(deps.exit).toHaveBeenCalledWith(2);
  });

  it('exits with code 1 if spawnSyncImpl returns undefined status', () => {
    // Return an object with all required properties but status undefined
    deps.spawnSyncImpl.mockReturnValueOnce({
      pid: 123,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: undefined,
    });
    runCli(['node', 'cli.js', 'migrate'], deps);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('routes install-skills command to runInstallSkillsImpl', () => {
    // Act
    runCli(['node', 'cli.js', 'install-skills'], deps);

    // Assert
    expect(deps.runInstallSkillsImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        log: deps.log,
        error: deps.error,
        exit: deps.exit,
      }),
    );
  });

  it('routes install-rules command to runInstallRulesImpl', () => {
    // Act
    runCli(['node', 'cli.js', 'install-rules'], deps);

    // Assert
    expect(deps.runInstallRulesImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        log: deps.log,
        error: deps.error,
        exit: deps.exit,
      }),
    );
  });

  it('routes install-mcp command to runInstallMcpImpl', () => {
    // Act
    runCli(['node', 'cli.js', 'install-mcp'], deps);

    // Assert
    expect(deps.runInstallMcpImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        log: deps.log,
        error: deps.error,
        exit: deps.exit,
      }),
    );
  });

  it('routes mcp command to startMcpServerImpl', () => {
    // Act
    runCli(['node', 'cli.js', 'mcp'], deps);

    // Assert
    expect(deps.startMcpServerImpl).toHaveBeenCalled();
  });

  it('shows new commands in usage output', () => {
    // Act
    runCli(['node', 'cli.js'], deps);

    // Assert
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli install-skills');
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli install-rules');
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli install-mcp');
    expect(deps.log).toHaveBeenCalledWith('  dataqueue-cli mcp');
  });
});
