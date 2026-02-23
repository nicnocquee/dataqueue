import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runInstallMcp,
  upsertMcpConfig,
  InstallMcpDeps,
} from './install-mcp-command.js';

describe('upsertMcpConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates new config file when it does not exist', () => {
    // Setup
    const deps = {
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMcpConfig(
      '/path/mcp.json',
      'dataqueue',
      { command: 'npx', args: ['dataqueue-cli', 'mcp'] },
      deps,
    );

    // Assert
    const written = JSON.parse(deps.writeFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.dataqueue).toEqual({
      command: 'npx',
      args: ['dataqueue-cli', 'mcp'],
    });
  });

  it('adds to existing config without overwriting other servers', () => {
    // Setup
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'other' } },
    });
    const deps = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => existing),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMcpConfig(
      '/path/mcp.json',
      'dataqueue',
      { command: 'npx', args: ['dataqueue-cli', 'mcp'] },
      deps,
    );

    // Assert
    const written = JSON.parse(deps.writeFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.other).toEqual({ command: 'other' });
    expect(written.mcpServers.dataqueue).toEqual({
      command: 'npx',
      args: ['dataqueue-cli', 'mcp'],
    });
  });

  it('overwrites existing dataqueue entry', () => {
    // Setup
    const existing = JSON.stringify({
      mcpServers: { dataqueue: { command: 'old' } },
    });
    const deps = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => existing),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMcpConfig('/path/mcp.json', 'dataqueue', { command: 'new' }, deps);

    // Assert
    const written = JSON.parse(deps.writeFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.dataqueue).toEqual({ command: 'new' });
  });

  it('handles malformed JSON in existing file', () => {
    // Setup
    const deps = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => 'not json'),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMcpConfig('/path/mcp.json', 'dataqueue', { command: 'npx' }, deps);

    // Assert
    const written = JSON.parse(deps.writeFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.dataqueue).toEqual({ command: 'npx' });
  });
});

describe('runInstallMcp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDeps(overrides: Partial<InstallMcpDeps> = {}): InstallMcpDeps {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
      cwd: '/project',
      readFileSync: vi.fn(() => '{}'),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      ...overrides,
    };
  }

  it('installs MCP config for Cursor (option 1)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '1' });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledWith('/project/.cursor', {
      recursive: true,
    });
    const written = JSON.parse(
      (deps.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string,
    );
    expect(written.mcpServers.dataqueue.command).toBe('npx');
    expect(written.mcpServers.dataqueue.args).toEqual(['dataqueue-cli', 'mcp']);
  });

  it('installs MCP config for Claude Code (option 2)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '2' });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/project/.mcp.json',
      expect.any(String),
    );
  });

  it('installs MCP config for VS Code (option 3)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '3' });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledWith('/project/.vscode', {
      recursive: true,
    });
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.vscode/mcp.json'),
      expect.any(String),
    );
  });

  it('exits with error for invalid choice', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '99' });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid choice'),
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('handles install errors', async () => {
    // Setup
    const deps = makeDeps({
      selectedClient: '1',
      writeFileSync: vi.fn(() => {
        throw new Error('permission denied');
      }),
    });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.error).toHaveBeenCalledWith(
      'Failed to install MCP config:',
      expect.any(Error),
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('logs done message on success', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '1' });

    // Act
    await runInstallMcp(deps);

    // Assert
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('npx dataqueue-cli mcp'),
    );
  });
});
