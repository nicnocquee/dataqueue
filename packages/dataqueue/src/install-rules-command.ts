import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InstallRulesDeps {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  exit?: (code: number) => void;
  cwd?: string;
  readFileSync?: (p: string, enc: BufferEncoding) => string;
  writeFileSync?: (p: string, data: string) => void;
  appendFileSync?: (p: string, data: string) => void;
  mkdirSync?: (p: string, opts?: fs.MakeDirectoryOptions) => void;
  existsSync?: (p: string) => boolean;
  rulesSourceDir?: string;
  /** Override for selecting the client (skips interactive prompt). */
  selectedClient?: string;
}

const RULE_FILES = ['basic.md', 'advanced.md', 'react-dashboard.md'];

interface ClientConfig {
  label: string;
  install: (
    deps: Required<
      Pick<
        InstallRulesDeps,
        | 'cwd'
        | 'readFileSync'
        | 'writeFileSync'
        | 'appendFileSync'
        | 'mkdirSync'
        | 'existsSync'
        | 'log'
        | 'rulesSourceDir'
      >
    >,
  ) => void;
}

const MARKER_START = '<!-- DATAQUEUE RULES START -->';
const MARKER_END = '<!-- DATAQUEUE RULES END -->';

/**
 * Appends or replaces a marked section in a file.
 *
 * @param filePath - Path to the file to update.
 * @param content - Content to insert between markers.
 * @param deps - Injectable file system functions.
 */
export function upsertMarkedSection(
  filePath: string,
  content: string,
  deps: {
    readFileSync: (p: string, enc: BufferEncoding) => string;
    writeFileSync: (p: string, data: string) => void;
    existsSync: (p: string) => boolean;
  },
): void {
  const block = `${MARKER_START}\n${content}\n${MARKER_END}`;

  if (!deps.existsSync(filePath)) {
    deps.writeFileSync(filePath, block + '\n');
    return;
  }

  const existing = deps.readFileSync(filePath, 'utf-8');
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    deps.writeFileSync(filePath, before + block + after);
  } else {
    deps.writeFileSync(filePath, existing.trimEnd() + '\n\n' + block + '\n');
  }
}

function getAllRulesContent(
  rulesSourceDir: string,
  readFileSync: (p: string, enc: BufferEncoding) => string,
): string {
  return RULE_FILES.map((f) =>
    readFileSync(path.join(rulesSourceDir, f), 'utf-8'),
  ).join('\n\n');
}

const CLIENTS: Record<string, ClientConfig> = {
  '1': {
    label: 'Cursor',
    install: (deps) => {
      const rulesDir = path.join(deps.cwd, '.cursor', 'rules');
      deps.mkdirSync(rulesDir, { recursive: true });

      for (const file of RULE_FILES) {
        const src = deps.readFileSync(
          path.join(deps.rulesSourceDir, file),
          'utf-8',
        );
        const destName = `dataqueue-${file.replace(/\.md$/, '.mdc')}`;
        deps.writeFileSync(path.join(rulesDir, destName), src);
        deps.log(`  ✓ .cursor/rules/${destName}`);
      }
    },
  },
  '2': {
    label: 'Claude Code',
    install: (deps) => {
      const content = getAllRulesContent(
        deps.rulesSourceDir,
        deps.readFileSync,
      );
      const filePath = path.join(deps.cwd, 'CLAUDE.md');
      upsertMarkedSection(filePath, content, deps);
      deps.log(`  ✓ CLAUDE.md`);
    },
  },
  '3': {
    label: 'AGENTS.md (Codex, Jules, OpenCode)',
    install: (deps) => {
      const content = getAllRulesContent(
        deps.rulesSourceDir,
        deps.readFileSync,
      );
      const filePath = path.join(deps.cwd, 'AGENTS.md');
      upsertMarkedSection(filePath, content, deps);
      deps.log(`  ✓ AGENTS.md`);
    },
  },
  '4': {
    label: 'GitHub Copilot',
    install: (deps) => {
      const content = getAllRulesContent(
        deps.rulesSourceDir,
        deps.readFileSync,
      );
      deps.mkdirSync(path.join(deps.cwd, '.github'), { recursive: true });
      const filePath = path.join(
        deps.cwd,
        '.github',
        'copilot-instructions.md',
      );
      upsertMarkedSection(filePath, content, deps);
      deps.log(`  ✓ .github/copilot-instructions.md`);
    },
  },
  '5': {
    label: 'Windsurf',
    install: (deps) => {
      const content = getAllRulesContent(
        deps.rulesSourceDir,
        deps.readFileSync,
      );
      const filePath = path.join(deps.cwd, 'CONVENTIONS.md');
      upsertMarkedSection(filePath, content, deps);
      deps.log(`  ✓ CONVENTIONS.md`);
    },
  },
};

/**
 * Installs DataQueue agent rules for the selected AI client.
 *
 * @param deps - Injectable dependencies for testing.
 */
export async function runInstallRules({
  log = console.log,
  error = console.error,
  exit = (code: number) => process.exit(code),
  cwd = process.cwd(),
  readFileSync = fs.readFileSync,
  writeFileSync = fs.writeFileSync,
  appendFileSync = fs.appendFileSync,
  mkdirSync = fs.mkdirSync,
  existsSync = fs.existsSync,
  rulesSourceDir = path.join(__dirname, '../ai/rules'),
  selectedClient,
}: InstallRulesDeps = {}): Promise<void> {
  log('DataQueue Agent Rules Installer\n');
  log('Select your AI client:\n');

  for (const [key, client] of Object.entries(CLIENTS)) {
    log(`  ${key}) ${client.label}`);
  }
  log('');

  let choice = selectedClient;

  if (!choice) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    choice = await new Promise<string>((resolve) => {
      rl.question('Enter choice (1-5): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const client = CLIENTS[choice];
  if (!client) {
    error(`Invalid choice: "${choice}". Expected 1-5.`);
    exit(1);
    return;
  }

  log(`\nInstalling rules for ${client.label}...`);

  try {
    client.install({
      cwd,
      readFileSync,
      writeFileSync,
      appendFileSync,
      mkdirSync,
      existsSync,
      log,
      rulesSourceDir,
    });
    log('\nDone!');
  } catch (err) {
    error('Failed to install rules:', err);
    exit(1);
  }
}
