# Contributing to pg-bg-job-queue

Thank you for your interest in contributing to **pg-bg-job-queue**! Your help is greatly appreciated. This guide will help you get started with contributing, from setting up your environment to submitting your first pull request.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)
- [Code of Conduct](#code-of-conduct)

---

## Getting Started

1. **Fork the repository** on GitHub and clone your fork locally:
   ```bash
   git clone https://github.com/your-username/pg-bg-job-queue.git
   cd pg-bg-job-queue
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Set up your environment**:
   - Copy `.env.example` to `.env` and update the variables as needed (e.g., `DATABASE_URL`).
   - Make sure you have a PostgreSQL instance running and accessible.

## Development Workflow

- Create a new branch for your feature or bugfix:
  ```bash
  git checkout -b feature/your-feature-name
  # or
  git checkout -b fix/your-bugfix
  ```
- Make your changes, following the coding standards below.
- Add or update tests as needed.
- Run the test suite to ensure everything works:
  ```bash
  npm test
  ```
- Commit your changes with a clear, descriptive message.
- Push your branch and open a pull request (PR) against the `main` branch.

## Coding Standards

- Use **TypeScript** for all code.
- Follow the existing code style. We use [Prettier](https://prettier.io/) for formatting.
- Run `npm run format` before submitting your PR.
- Write clear, concise comments and documentation.
- Avoid using the `any` type; prefer strict typing.
- Group related code (components, hooks, utils) together for easier maintenance.

## Testing

- All new features and bug fixes should include relevant tests.
- First run `docker-compose up` to start the PostgreSQL container which will be used for testing.
- Run the test suite with:
  ```bash
  npm run test
  ```
- Add tests in the `src/` directory, following the existing test structure.
- Tests should be deterministic and not depend on external state.

## Submitting Changes

- Ensure your branch is up to date with `main` before opening a PR.
- Provide a clear description of your changes in the PR.
- Reference any related issues (e.g., `Closes #123`).
- Be responsive to feedback and make requested changes promptly.
- PRs should pass all CI checks before merging.

## Reporting Issues

If you find a bug or have a feature request:

- Search [existing issues](https://github.com/your-username/pg-bg-job-queue/issues) to avoid duplicates.
- Open a new issue with a clear title and detailed description.
- Include steps to reproduce, expected behavior, and relevant logs or screenshots.

## Code of Conduct

- Be respectful and inclusive in all interactions.
- Provide constructive feedback and be open to feedback on your contributions.
- See [Contributor Covenant](https://www.contributor-covenant.org/) for general guidelines.

---

Thank you for helping make **pg-bg-job-queue** better!
