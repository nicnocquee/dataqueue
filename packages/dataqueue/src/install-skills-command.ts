import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InstallSkillsDeps {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  exit?: (code: number) => void;
  cwd?: string;
  existsSync?: (p: string) => boolean;
  mkdirSync?: (p: string, opts?: fs.MakeDirectoryOptions) => void;
  copyFileSync?: (src: string, dest: string) => void;
  readdirSync?: (p: string) => string[];
  skillsSourceDir?: string;
}

const SKILL_DIRS = ['dataqueue-core', 'dataqueue-advanced', 'dataqueue-react'];

interface AiTool {
  name: string;
  targetDir: string;
}

/**
 * Detects which AI tools have config directories in the project.
 *
 * @param cwd - Current working directory to scan.
 * @param existsSync - Injectable fs.existsSync.
 * @returns Array of detected AI tools with their skills target directories.
 */
export function detectAiTools(
  cwd: string,
  existsSync: (p: string) => boolean = fs.existsSync,
): AiTool[] {
  const tools: AiTool[] = [];
  const checks: Array<{ name: string; indicator: string; targetDir: string }> =
    [
      {
        name: 'Cursor',
        indicator: '.cursor',
        targetDir: '.cursor/skills',
      },
      {
        name: 'Claude Code',
        indicator: '.claude',
        targetDir: '.claude/skills',
      },
      {
        name: 'GitHub Copilot',
        indicator: '.github',
        targetDir: '.github/skills',
      },
    ];

  for (const check of checks) {
    if (existsSync(path.join(cwd, check.indicator))) {
      tools.push({ name: check.name, targetDir: check.targetDir });
    }
  }

  return tools;
}

/**
 * Installs DataQueue skill files into detected AI tool directories.
 *
 * @param deps - Injectable dependencies for testing.
 */
export function runInstallSkills({
  log = console.log,
  error = console.error,
  exit = (code: number) => process.exit(code),
  cwd = process.cwd(),
  existsSync = fs.existsSync,
  mkdirSync = fs.mkdirSync,
  copyFileSync = fs.copyFileSync,
  readdirSync = fs.readdirSync,
  skillsSourceDir = path.join(__dirname, '../ai/skills'),
}: InstallSkillsDeps = {}): void {
  const tools = detectAiTools(cwd, existsSync);

  if (tools.length === 0) {
    log('No AI tool directories detected (.cursor/, .claude/, .github/).');
    log('Creating .cursor/skills/ as the default target.');
    tools.push({ name: 'Cursor', targetDir: '.cursor/skills' });
  }

  let installed = 0;

  for (const tool of tools) {
    log(`\nInstalling skills for ${tool.name}...`);

    for (const skillDir of SKILL_DIRS) {
      const srcDir = path.join(skillsSourceDir, skillDir);
      const destDir = path.join(cwd, tool.targetDir, skillDir);

      try {
        mkdirSync(destDir, { recursive: true });

        const files = readdirSync(srcDir);
        for (const file of files) {
          copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }

        log(`  ✓ ${skillDir}`);
        installed++;
      } catch (err) {
        error(`  ✗ Failed to install ${skillDir}:`, err);
      }
    }
  }

  if (installed > 0) {
    log(
      `\nDone! Installed ${installed} skill(s) for ${tools.map((t) => t.name).join(', ')}.`,
    );
  } else {
    error('No skills were installed.');
    exit(1);
  }
}
