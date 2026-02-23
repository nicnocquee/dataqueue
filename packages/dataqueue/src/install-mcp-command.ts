import fs from 'fs';
import path from 'path';
import readline from 'readline';

export interface InstallMcpDeps {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  exit?: (code: number) => void;
  cwd?: string;
  readFileSync?: (p: string, enc: BufferEncoding) => string;
  writeFileSync?: (p: string, data: string) => void;
  mkdirSync?: (p: string, opts?: fs.MakeDirectoryOptions) => void;
  existsSync?: (p: string) => boolean;
  /** Override for selecting the client (skips interactive prompt). */
  selectedClient?: string;
}

interface McpClientConfig {
  label: string;
  install: (
    deps: Required<
      Pick<
        InstallMcpDeps,
        | 'cwd'
        | 'readFileSync'
        | 'writeFileSync'
        | 'mkdirSync'
        | 'existsSync'
        | 'log'
      >
    >,
  ) => void;
}

/**
 * Merges the dataqueue MCP server config into an existing JSON config file.
 *
 * @param filePath - Path to the MCP config file.
 * @param serverKey - Key name for the server entry.
 * @param serverConfig - Server configuration object.
 * @param deps - Injectable file system functions.
 */
export function upsertMcpConfig(
  filePath: string,
  serverKey: string,
  serverConfig: Record<string, unknown>,
  deps: {
    readFileSync: (p: string, enc: BufferEncoding) => string;
    writeFileSync: (p: string, data: string) => void;
    existsSync: (p: string) => boolean;
  },
): void {
  let config: Record<string, unknown> = {};

  if (deps.existsSync(filePath)) {
    try {
      config = JSON.parse(deps.readFileSync(filePath, 'utf-8'));
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }

  (config.mcpServers as Record<string, unknown>)[serverKey] = serverConfig;
  deps.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['dataqueue-cli', 'mcp'],
};

const MCP_CLIENTS: Record<string, McpClientConfig> = {
  '1': {
    label: 'Cursor',
    install: (deps) => {
      const configDir = path.join(deps.cwd, '.cursor');
      deps.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, 'mcp.json');
      upsertMcpConfig(configFile, 'dataqueue', MCP_SERVER_CONFIG, deps);
      deps.log(`  ✓ .cursor/mcp.json`);
    },
  },
  '2': {
    label: 'Claude Code',
    install: (deps) => {
      const configFile = path.join(deps.cwd, '.mcp.json');
      upsertMcpConfig(configFile, 'dataqueue', MCP_SERVER_CONFIG, deps);
      deps.log(`  ✓ .mcp.json`);
    },
  },
  '3': {
    label: 'VS Code (Copilot)',
    install: (deps) => {
      const configDir = path.join(deps.cwd, '.vscode');
      deps.mkdirSync(configDir, { recursive: true });
      const configFile = path.join(configDir, 'mcp.json');
      upsertMcpConfig(configFile, 'dataqueue', MCP_SERVER_CONFIG, deps);
      deps.log(`  ✓ .vscode/mcp.json`);
    },
  },
  '4': {
    label: 'Windsurf',
    install: (deps) => {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const configFile = path.join(
        homeDir,
        '.codeium',
        'windsurf',
        'mcp_config.json',
      );
      deps.mkdirSync(path.dirname(configFile), { recursive: true });
      upsertMcpConfig(configFile, 'dataqueue', MCP_SERVER_CONFIG, deps);
      deps.log(`  ✓ ~/.codeium/windsurf/mcp_config.json`);
    },
  },
};

/**
 * Installs the DataQueue MCP server config for the selected AI client.
 *
 * @param deps - Injectable dependencies for testing.
 */
export async function runInstallMcp({
  log = console.log,
  error = console.error,
  exit = (code: number) => process.exit(code),
  cwd = process.cwd(),
  readFileSync = fs.readFileSync,
  writeFileSync = fs.writeFileSync,
  mkdirSync = fs.mkdirSync,
  existsSync = fs.existsSync,
  selectedClient,
}: InstallMcpDeps = {}): Promise<void> {
  log('DataQueue MCP Server Installer\n');
  log('Select your AI client:\n');

  for (const [key, client] of Object.entries(MCP_CLIENTS)) {
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
      rl.question('Enter choice (1-4): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const client = MCP_CLIENTS[choice];
  if (!client) {
    error(`Invalid choice: "${choice}". Expected 1-4.`);
    exit(1);
    return;
  }

  log(`\nInstalling MCP config for ${client.label}...`);

  try {
    client.install({
      cwd,
      readFileSync,
      writeFileSync,
      mkdirSync,
      existsSync,
      log,
    });
    log('\nDone! The MCP server will run via: npx dataqueue-cli mcp');
  } catch (err) {
    error('Failed to install MCP config:', err);
    exit(1);
  }
}
