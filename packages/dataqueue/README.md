# DataQueue

A lightweight job queue backed by PostgreSQL or Redis.

- [Website](https://dataqueue.dev)
- [Documentation](https://docs.dataqueue.dev)

## Installation

```bash
npm install @nicnocquee/dataqueue
```

## Testing

First, run the following command to start the PostgreSQL and Redis containers:

```bash
docker-compose up
```

Then, run the tests:

```bash
pnpm run test
```

For E2E tests, run the following command:

```bash
# First time: create DB and run migrations
PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -c "CREATE DATABASE e2e_test;"
cd apps/e2e && PG_DATAQUEUE_DATABASE=postgres://postgres:postgres@localhost:5432/e2e_test pnpm run migrate-dataqueue
# Run tests
pnpm test:e2e
```

## License

MIT

## Author

[Nico Prananta](https://nico.fyi)
