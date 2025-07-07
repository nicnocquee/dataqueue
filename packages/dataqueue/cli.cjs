#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function printUsage() {
  console.log(
    'Usage: dataqueue-cli migrate [--envPath <path>] [-s <schema> | --schema <schema>]',
  );
  console.log('');
  console.log('Options:');
  console.log(
    '  --envPath <path>   Path to a .env file to load environment variables (passed to node-pg-migrate)',
  );
  console.log(
    '  -s, --schema <schema>  Set the schema to use (passed to node-pg-migrate)',
  );
  console.log('');
  console.log('Notes:');
  console.log(
    '  - The PG_DATAQUEUE_DATABASE environment variable must be set to your Postgres connection string.',
  );
  process.exit(1);
}

const [, , command, ...restArgs] = process.argv;

if (command === 'migrate') {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Support for -s or --schema argument
  let schemaArg = [];
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
  let envPathArg = [];
  const envPathIndex = restArgs.indexOf('--envPath');
  if (envPathIndex !== -1 && restArgs[envPathIndex + 1]) {
    envPathArg = ['--envPath', restArgs[envPathIndex + 1]];
  }

  const result = spawnSync(
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
  process.exit(result.status);
} else {
  printUsage();
}
