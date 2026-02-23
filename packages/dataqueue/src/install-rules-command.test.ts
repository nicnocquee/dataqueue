import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runInstallRules,
  upsertMarkedSection,
  InstallRulesDeps,
} from './install-rules-command.js';

describe('upsertMarkedSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates file with markers when file does not exist', () => {
    // Setup
    const deps = {
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMarkedSection('/path/file.md', 'content here', deps);

    // Assert
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/path/file.md',
      expect.stringContaining('<!-- DATAQUEUE RULES START -->'),
    );
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/path/file.md',
      expect.stringContaining('content here'),
    );
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/path/file.md',
      expect.stringContaining('<!-- DATAQUEUE RULES END -->'),
    );
  });

  it('replaces existing marked section', () => {
    // Setup
    const existing =
      'before\n<!-- DATAQUEUE RULES START -->\nold content\n<!-- DATAQUEUE RULES END -->\nafter';
    const deps = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => existing),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMarkedSection('/path/file.md', 'new content', deps);

    // Assert
    const written = deps.writeFileSync.mock.calls[0][1] as string;
    expect(written).toContain('before\n');
    expect(written).toContain('new content');
    expect(written).not.toContain('old content');
    expect(written).toContain('\nafter');
  });

  it('appends to file when no markers exist', () => {
    // Setup
    const deps = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '# Existing content'),
      writeFileSync: vi.fn(),
    };

    // Act
    upsertMarkedSection('/path/file.md', 'new content', deps);

    // Assert
    const written = deps.writeFileSync.mock.calls[0][1] as string;
    expect(written).toContain('# Existing content');
    expect(written).toContain('new content');
  });
});

describe('runInstallRules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDeps(
    overrides: Partial<InstallRulesDeps> = {},
  ): InstallRulesDeps {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
      cwd: '/project',
      readFileSync: vi.fn(() => '# Rule content'),
      writeFileSync: vi.fn(),
      appendFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      rulesSourceDir: '/pkg/ai/rules',
      ...overrides,
    };
  }

  it('installs rules for Cursor (option 1)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '1' });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledWith('/project/.cursor/rules', {
      recursive: true,
    });
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.cursor/rules/dataqueue-basic.mdc'),
      expect.any(String),
    );
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.cursor/rules/dataqueue-advanced.mdc'),
      expect.any(String),
    );
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.cursor/rules/dataqueue-react-dashboard.mdc'),
      expect.any(String),
    );
  });

  it('installs rules for Claude Code (option 2)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '2' });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/project/CLAUDE.md',
      expect.stringContaining('<!-- DATAQUEUE RULES START -->'),
    );
  });

  it('installs rules for AGENTS.md (option 3)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '3' });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/project/AGENTS.md',
      expect.stringContaining('<!-- DATAQUEUE RULES START -->'),
    );
  });

  it('installs rules for GitHub Copilot (option 4)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '4' });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledWith('/project/.github', {
      recursive: true,
    });
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/project/.github/copilot-instructions.md',
      expect.stringContaining('<!-- DATAQUEUE RULES START -->'),
    );
  });

  it('installs rules for Windsurf (option 5)', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '5' });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.writeFileSync).toHaveBeenCalledWith(
      '/project/CONVENTIONS.md',
      expect.stringContaining('<!-- DATAQUEUE RULES START -->'),
    );
  });

  it('exits with error for invalid choice', async () => {
    // Setup
    const deps = makeDeps({ selectedClient: '99' });

    // Act
    await runInstallRules(deps);

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
      readFileSync: vi.fn(() => {
        throw new Error('file not found');
      }),
    });

    // Act
    await runInstallRules(deps);

    // Assert
    expect(deps.error).toHaveBeenCalledWith(
      'Failed to install rules:',
      expect.any(Error),
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
