## Development

- Run `pnpm i` from the root of the repo
- Run `env $(cat .env.local | grep -v '^#' | xargs) pnpm run migrate-pg-bg-job-queue` from the `apps/demo` directory to run migrations.
- Run `pnpm dev` from the root directory to start the development server, the build process of the pg-bg-job-queue package in watch mode, and the cron job to process jobs, cleanup, and reclaim.
