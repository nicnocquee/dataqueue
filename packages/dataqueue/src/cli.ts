// Testable CLI logic for dataqueue
import { spawnSync, SpawnSyncReturns } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { InitDeps, runInit } from './init-command.js';
import {
  runInstallSkills,
  InstallSkillsDeps,
} from './install-skills-command.js';
import { runInstallRules, InstallRulesDeps } from './install-rules-command.js';
import { runInstallMcp, InstallMcpDeps } from './install-mcp-command.js';
import { startMcpServer } from './mcp-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliDeps {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  exit?: (code: number) => void;
  spawnSyncImpl?: (...args: any[]) => SpawnSyncReturns<any>;
  migrationsDir?: string;
  initDeps?: InitDeps;
  runInitImpl?: (deps?: InitDeps) => void;
  installSkillsDeps?: InstallSkillsDeps;
  runInstallSkillsImpl?: (deps?: InstallSkillsDeps) => void;
  installRulesDeps?: InstallRulesDeps;
  runInstallRulesImpl?: (deps?: InstallRulesDeps) => Promise<void>;
  installMcpDeps?: InstallMcpDeps;
  runInstallMcpImpl?: (deps?: InstallMcpDeps) => Promise<void>;
  startMcpServerImpl?: typeof startMcpServer;
}

export function runCli(
  argv: string[],
  {
    log = console.log,
    error = console.error,
    exit = (code: number) => process.exit(code),
    spawnSyncImpl = spawnSync,
    migrationsDir = path.join(__dirname, '../migrations'),
    initDeps,
    runInitImpl = runInit,
    installSkillsDeps,
    runInstallSkillsImpl = runInstallSkills,
    installRulesDeps,
    runInstallRulesImpl = runInstallRules,
    installMcpDeps,
    runInstallMcpImpl = runInstallMcp,
    startMcpServerImpl = startMcpServer,
  }: CliDeps = {},
): void {
  const [, , command, ...restArgs] = argv;

  function printUsage() {
    log('Usage:');
    log(
      '  dataqueue-cli migrate [--envPath <path>] [-s <schema> | --schema <schema>]',
    );
    log('  dataqueue-cli init');
    log('  dataqueue-cli install-skills');
    log('  dataqueue-cli install-rules');
    log('  dataqueue-cli install-mcp');
    log('  dataqueue-cli mcp');
    log('');
    log('Options for migrate:');
    log(
      '  --envPath <path>   Path to a .env file to load environment variables (passed to node-pg-migrate)',
    );
    log(
      '  -s, --schema <schema>  Set the schema to use (passed to node-pg-migrate)',
    );
    log('');
    log('AI tooling commands:');
    log('  install-skills     Install DataQueue skill files for AI assistants');
    log('  install-rules      Install DataQueue agent rules for AI clients');
    log(
      '  install-mcp        Configure the DataQueue MCP server for AI clients',
    );
    log('  mcp                Start the DataQueue MCP server (stdio)');
    exit(1);
  }

  if (command === 'migrate') {
    // Support for -s or --schema argument
    let schemaArg: string[] = [];
    const sIndex = restArgs.indexOf('-s');
    const schemaIndex = restArgs.indexOf('--schema');
    if (sIndex !== -1 && restArgs[sIndex + 1]) {
      schemaArg = ['-s', restArgs[sIndex + 1], '--create-schema'];
      restArgs.splice(sIndex, 2);
    } else if (schemaIndex !== -1 && restArgs[schemaIndex + 1]) {
      schemaArg = ['-s', restArgs[schemaIndex + 1], '--create-schema'];
      restArgs.splice(schemaIndex, 2);
    }

    // Support for --envPath argument
    let envPathArg: string[] = [];
    const envPathIndex = restArgs.indexOf('--envPath');
    if (envPathIndex !== -1 && restArgs[envPathIndex + 1]) {
      envPathArg = ['--envPath', restArgs[envPathIndex + 1]];
    }

    const result: SpawnSyncReturns<any> = spawnSyncImpl(
      'npx',
      [
        'node-pg-migrate',
        'up',
        '-t',
        'dataqueuedev_migrations',
        '-d',
        'PG_DATAQUEUE_DATABASE',
        '-m',
        migrationsDir,
        ...schemaArg,
        ...envPathArg,
        ...restArgs,
      ],
      { stdio: 'inherit' },
    );
    exit(result.status ?? 1);
  } else if (command === 'init') {
    runInitImpl({
      log,
      error,
      exit,
      ...initDeps,
    });
  } else if (command === 'install-skills') {
    runInstallSkillsImpl({
      log,
      error,
      exit,
      ...installSkillsDeps,
    });
  } else if (command === 'install-rules') {
    runInstallRulesImpl({
      log,
      error,
      exit,
      ...installRulesDeps,
    });
  } else if (command === 'install-mcp') {
    runInstallMcpImpl({
      log,
      error,
      exit,
      ...installMcpDeps,
    });
  } else if (command === 'mcp') {
    startMcpServerImpl().catch((err) => {
      error('Failed to start MCP server:', err);
      exit(1);
    });
  } else {
    printUsage();
  }
}
