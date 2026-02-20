# Contributing to Joyus AI

Thank you for your interest in contributing. This document covers how to get started, development setup, and the conventions we follow.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards.

## How to Contribute

### Reporting Issues

File issues on the [GitHub issue tracker](https://github.com/Priivacy-ai/joyus-ai/issues). Include:
- A clear description of the problem or feature request
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Environment details (OS, Node.js version, Python version)

### Submitting Changes

1. **Fork** the repository and clone your fork locally.
2. **Create a branch** from `main` with a descriptive name:
   ```
   git checkout -b feat/my-feature
   git checkout -b fix/issue-description
   ```
3. **Make your changes** following the code style conventions below.
4. **Test your changes** — ensure existing tests pass and add tests for new behavior.
5. **Commit** using the commit message conventions below.
6. **Push** your branch and open a **Pull Request** against `main`.
7. Respond to review feedback. PRs are merged after at least one approval.

Keep PRs focused. One feature or fix per PR makes review faster and history cleaner.

## Development Setup

### Prerequisites

- **Node.js** 20+ and **npm** 9+ (for the MCP server and session state packages)
- **Python** 3.11 or 3.12 (for the profile engine; 3.13+ not yet supported)
- **Docker** and **Docker Compose** (optional, for integration testing)

### TypeScript Packages

The MCP server (`joyus-ai-mcp-server/`) and session state (`joyus-ai-state/`) packages are standard Node.js projects:

```bash
# Install dependencies
cd joyus-ai-mcp-server
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npx tsc --noEmit
```

Repeat the same steps in `joyus-ai-state/` as needed.

### Python Profile Engine

The profile engine (`joyus-profile-engine/`) uses a virtual environment:

```bash
cd joyus-profile-engine
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run tests
pytest

# Lint and format
ruff check .
ruff format .
```

### Environment Variables

Copy `.env.example` to `.env` in any package directory that provides one, and fill in the required values. The `.env` file is gitignored — never commit secrets.

## Code Style

### TypeScript

- **Formatter**: [Prettier](https://prettier.io/) — run `npx prettier --write .`
- **Linter**: [ESLint](https://eslint.org/) — run `npx eslint .`
- **Schemas first**: define Zod schemas in `schema.ts`; infer types via `z.infer<>` in `types.ts`. Do not hand-write duplicate type definitions.
- Prefer `const` over `let`. Avoid `any`; use `unknown` and narrow explicitly.
- Export only what other modules need. Keep internal helpers unexported.

### Python

- **Formatter/Linter**: [Ruff](https://docs.astral.sh/ruff/) — run `ruff check . && ruff format .`
- **Type hints**: required on all public functions and class members. Use `from __future__ import annotations` for forward references.
- **Models**: use Pydantic v2. Prefer `model_validator` over manual `__init__` overrides.
- Python 3.11+ syntax is acceptable (match statements, `tomllib`, etc.).

### General

- No client names, real person names, or client-specific terminology anywhere in this repository. See `spec/constitution.md §2.10` for the client abstraction rule.
- Use generic examples in docs, tests, and fixtures: "Author A", "Example Corp", "Formal (Courts)", "Technical (Practitioners)".

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`

**Scope**: the package or area changed — e.g., `mcp-server`, `state`, `profile-engine`, `deploy`, `spec`

**Examples**:
```
feat(state): add divergence detection for canonical documents
fix(mcp-server): handle missing env vars at startup gracefully
docs(contributing): add Python setup instructions
test(profile-engine): add fixtures for multi-voice fidelity checks
```

Keep the summary line under 72 characters. Use the body to explain _why_, not _what_.

## Project Structure Notes

- Feature specs live in `kitty-specs/<feature-id>/` — read the spec before implementing.
- The project constitution at `spec/constitution.md` defines hard constraints. Read it before making architectural decisions.
- Client-specific content belongs in private deployment repos, not here.

## Questions

Open a [GitHub Discussion](https://github.com/Priivacy-ai/joyus-ai/discussions) for design questions or ideas that aren't yet a concrete issue.
