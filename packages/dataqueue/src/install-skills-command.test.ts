import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runInstallSkills,
  detectAiTools,
  InstallSkillsDeps,
} from './install-skills-command.js';

describe('detectAiTools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Cursor when .cursor directory exists', () => {
    // Setup
    const existsSync = vi.fn((p: string) => p.endsWith('.cursor'));

    // Act
    const tools = detectAiTools('/project', existsSync);

    // Assert
    expect(tools).toEqual([{ name: 'Cursor', targetDir: '.cursor/skills' }]);
  });

  it('detects multiple AI tools', () => {
    // Setup
    const existsSync = vi.fn(() => true);

    // Act
    const tools = detectAiTools('/project', existsSync);

    // Assert
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      'Cursor',
      'Claude Code',
      'GitHub Copilot',
    ]);
  });

  it('returns empty array when no tools detected', () => {
    // Setup
    const existsSync = vi.fn(() => false);

    // Act
    const tools = detectAiTools('/project', existsSync);

    // Assert
    expect(tools).toEqual([]);
  });
});

describe('runInstallSkills', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDeps(
    overrides: Partial<InstallSkillsDeps> = {},
  ): InstallSkillsDeps {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
      cwd: '/project',
      existsSync: vi.fn((p: string) => p.endsWith('.cursor')),
      mkdirSync: vi.fn(),
      copyFileSync: vi.fn(),
      readdirSync: vi.fn(() => ['SKILL.md']),
      skillsSourceDir: '/pkg/ai/skills',
      ...overrides,
    };
  }

  it('installs skills for detected AI tools', () => {
    // Setup
    const deps = makeDeps();

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledTimes(3);
    expect(deps.copyFileSync).toHaveBeenCalledTimes(3);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('Done! Installed 3 skill(s)'),
    );
  });

  it('creates .cursor/skills as default when no AI tools detected', () => {
    // Setup
    const deps = makeDeps({
      existsSync: vi.fn(() => false),
    });

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('Creating .cursor/skills/'),
    );
    expect(deps.mkdirSync).toHaveBeenCalled();
  });

  it('copies each SKILL.md file to the target directory', () => {
    // Setup
    const deps = makeDeps();

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.copyFileSync).toHaveBeenCalledWith(
      '/pkg/ai/skills/dataqueue-core/SKILL.md',
      '/project/.cursor/skills/dataqueue-core/SKILL.md',
    );
    expect(deps.copyFileSync).toHaveBeenCalledWith(
      '/pkg/ai/skills/dataqueue-advanced/SKILL.md',
      '/project/.cursor/skills/dataqueue-advanced/SKILL.md',
    );
    expect(deps.copyFileSync).toHaveBeenCalledWith(
      '/pkg/ai/skills/dataqueue-react/SKILL.md',
      '/project/.cursor/skills/dataqueue-react/SKILL.md',
    );
  });

  it('handles copy errors gracefully', () => {
    // Setup
    const deps = makeDeps({
      copyFileSync: vi.fn(() => {
        throw new Error('permission denied');
      }),
    });

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to install'),
      expect.any(Error),
    );
  });

  it('exits with code 1 when all installs fail', () => {
    // Setup
    const deps = makeDeps({
      readdirSync: vi.fn(() => {
        throw new Error('not found');
      }),
    });

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.error).toHaveBeenCalledWith('No skills were installed.');
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('installs for multiple detected tools', () => {
    // Setup
    const deps = makeDeps({
      existsSync: vi.fn(() => true),
    });

    // Act
    runInstallSkills(deps);

    // Assert
    expect(deps.mkdirSync).toHaveBeenCalledTimes(9);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('Cursor, Claude Code, GitHub Copilot'),
    );
  });
});
