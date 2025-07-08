# Contributing to dataqueue (Monorepo)

Thank you for your interest in contributing to **dataqueue**! Your help is greatly appreciated. This guide will help you get started with contributing to the monorepo, from setting up your environment to submitting your first pull request.

## Table of Contents

- [Monorepo Structure](#monorepo-structure)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)
- [Code of Conduct](#code-of-conduct)

---

## Monorepo Structure

- `packages/dataqueue`: The main library package.
- `apps/docs`: The documentation site.
- `apps/demo`: Example Next.js app using the library.

## Getting Started

1. **Fork the repository** on GitHub and clone your fork locally:
   ```bash
   git clone https://github.com/your-username/dataqueue.git
   cd dataqueue
   ```
2. **Install dependencies** (using pnpm):
   ```bash
   pnpm install
   ```
3. **Set up your environment**:
   - Copy `env.example` to `.env` and update the variables as needed (e.g., `DATABASE_URL`).
   - Make sure you have a PostgreSQL instance running and accessible. You can use the docker-compose file in the root of the monorepo to start a PostgreSQL instance:
     ```bash
     docker-compose up
     ```
4. **Run the demo app**:

   ```bash
   pnpm dev
   ```

   This wil run three things: the demo Next.js app, the library in watch mode, and the cron job to trigger the jobs processing, reclaim stuck jobs, and cleanup old jobs.

## Development Workflow

- Create a new branch for your feature or bugfix:
  ```bash
  git checkout -b feature/your-feature-name
  # or
  git checkout -b fix/your-bugfix
  ```
- Run `pnpm dev` from the root of the monorepo to start the demo app and the library in watch mode.
- Make your changes, following the coding standards below.
- Add or update tests as needed.
- Run the test suite to ensure everything works:
  ```bash
  cd packages/dataqueue && pnpm test
  ```
- To build the library:
  ```bash
  cd packages/dataqueue && pnpm build
  ```
- To run the demo app:
  ```bash
  pnpm dev
  ```
- Commit your changes with a clear, descriptive message.
- Push your branch and open a pull request (PR) against the `main` branch.

## Coding Standards

- Use **TypeScript** for all code.
- Follow the existing code style. We use [Prettier](https://prettier.io/) for formatting.
- Run `pnpm format` before submitting your PR.
- Write clear, concise comments and documentation.
- Avoid using the `any` type; prefer strict typing.
- Group related code (components, hooks, utils) together for easier maintenance.

## Documentation

- The documentation is using Fumadocs and written in [MDX](https://mdxjs.com/) format.
- The documentation is written in the `apps/docs/content/docs` directory.
- Create or update the documentation for the changes you made.
- Run `pnpm dev` in the `apps/docs` directory to preview the documentation.

## Testing

- All new features and bug fixes should include relevant tests.
- First run `docker-compose up` to start the PostgreSQL container which will be used for testing.
- Run the test suite with:
  ```bash
  cd packages/dataqueue && pnpm test
  ```
- Add tests in the `src/` directory of the package with the name `*.test.ts`, following the existing test structure.
- Tests should be deterministic and not depend on external state.
- In this project, the tests don't mock the database. They use the real postgres database. That's why you need to run `docker-compose up` before running the tests. Before each test, a new schema in the PostgreSQL database will be created. The code will be executed in the context of the new schema. See the existing tests for reference.

## Submitting Changes

- Ensure your branch is up to date with `main` before opening a PR.
- Run `pnpm changeset:add` to add a new changeset. Here you can choose the type of change (major, minor, patch) and the scope of the change.
- Make changes in the changeset if needed. Then commit the changeset.
- Provide a clear description of your changes in the PR.
- Reference any related issues (e.g., `Resolves #123`).
- Be responsive to feedback and make requested changes promptly.
- PRs should pass all CI checks before merging.
- **Publishing:** The library is published to npm automatically by CI using Changesets when changes are merged to `main` and a version bump is present.

## Publishing

- Run `pnpm changeset:version` to bump the version of the package. This will bump the version of the package, update the changelog, and delete the changeset files that are not the README.md.
- Commit the changes and push to the `main` branch.
- Create a new release on GitHub. Use the version number from the changeset as the release version. Use the changelog as the release description.

## Reporting Issues

If you find a bug or have a feature request:

- Search [existing issues](https://github.com/your-username/dataqueue/issues) to avoid duplicates.
- Open a new issue with a clear title and detailed description.
- Include steps to reproduce, expected behavior, and relevant logs or screenshots.

## Code of Conduct

- Be respectful and inclusive in all interactions.
- Provide constructive feedback and be open to feedback on your contributions.
- See [Contributor Covenant](https://www.contributor-covenant.org/) for general guidelines.

---

Thank you for helping make **dataqueue** better!
