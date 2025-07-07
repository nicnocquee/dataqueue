// Testable CLI logic for dataqueue
import { spawnSync, SpawnSyncReturns } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliDeps {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  exit?: (code: number) => void;
  spawnSyncImpl?: (...args: any[]) => SpawnSyncReturns<any>;
  migrationsDir?: string;
}

export function runCli(
  argv: string[],
  {
    log = console.log,
    exit = (code: number) => process.exit(code),
    spawnSyncImpl = spawnSync,
    migrationsDir = path.join(__dirname, '../migrations'),
  }: CliDeps = {},
): void {
  const [, , command, ...restArgs] = argv;

  function printUsage() {
    log(
      'Usage: dataqueue-cli migrate [--envPath <path>] [-s <schema> | --schema <schema>]',
    );
    log('');
    log('Options:');
    log(
      '  --envPath <path>   Path to a .env file to load environment variables (passed to node-pg-migrate)',
    );
    log(
      '  -s, --schema <schema>  Set the schema to use (passed to node-pg-migrate)',
    );
    log('');
    log('Notes:');
    log(
      '  - The PG_DATAQUEUE_DATABASE environment variable must be set to your Postgres connection string.',
    );
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
  } else {
    printUsage();
  }
}
