## Development

- Run `pnpm i` from the root of the repo
- Copy the `env.example` file to `.env.local` and fill in the values.
- Run `env $(cat .env.local | grep -v '^#' | xargs) pnpm run migrate-dataqueue` from the `apps/demo` directory to run migrations.
- Run `pnpm dev` from the root directory to start the development server, the build process of the dataqueue package in watch mode, and the cron job to process jobs, cleanup, and reclaim.
