#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function printUsage() {
  console.log('Usage: dataqueue-cli migrate');
  process.exit(1);
}

const [, , command] = process.argv;

if (command === 'migrate') {
  const migrationsDir = path.join(__dirname, 'migrations');
  const dbUrl = process.env.PG_BG_JOB_QUEUE_DATABASE;
  console.log(dbUrl);
  if (!dbUrl) {
    console.error(
      'Error: PG_BG_JOB_QUEUE_DATABASE environment variable must be set to your Postgres connection string.',
    );
    process.exit(1);
  }
  const result = spawnSync(
    'npx',
    [
      'node-pg-migrate',
      'up',
      '-d',
      'PG_BG_JOB_QUEUE_DATABASE',
      '--tsconfig',
      './tsconfig.json',
      '-m',
      migrationsDir,
    ],
    { stdio: 'inherit' },
  );
  process.exit(result.status);
} else {
  printUsage();
}
