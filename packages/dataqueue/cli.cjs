#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function printUsage() {
  console.log('Usage: dataqueue-cli migrate [--envPath <path>]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --envPath <path>   Path to a .env file to load environment variables (passed to node-pg-migrate)',
  );
  console.log('');
  console.log('Notes:');
  console.log(
    '  - The PG_DATAQUEUE_DATABASE environment variable must be set to your Postgres connection string.',
  );
  console.log(
    '  - If the connection string contains a search_path parameter, the CLI will automatically set the schema and add --create-schema.',
  );
  process.exit(1);
}

const [, , command, ...restArgs] = process.argv;

if (command === 'migrate') {
  const migrationsDir = path.join(__dirname, 'migrations');
  const dbUrl = process.env.PG_DATAQUEUE_DATABASE;

  // Parse search_path from dbUrl if present
  let schemaArg = [];
  let hasCustomSchema = false;
  try {
    const urlObj = new URL(dbUrl);
    if (urlObj.searchParams.has('search_path')) {
      const searchPath = urlObj.searchParams.get('search_path');
      if (searchPath) {
        schemaArg = ['-s', searchPath];
        hasCustomSchema = true;
      }
    }
  } catch (e) {
    const match = dbUrl.match(/[?&]search_path=([^&]+)/);
    if (match && match[1]) {
      schemaArg = ['-s', decodeURIComponent(match[1])];
      hasCustomSchema = true;
    }
  }
  if (hasCustomSchema) {
    schemaArg.push('--create-schema');
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
    ],
    { stdio: 'inherit' },
  );
  process.exit(result.status);
} else {
  printUsage();
}
