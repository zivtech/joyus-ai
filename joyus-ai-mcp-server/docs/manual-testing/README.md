# Manual Testing Documents

Manual testing runbooks live in this directory.

## Naming Convention

Use this filename format:

```text
<feature-or-area>-manual-test.md
```

Rules:

- Use lowercase kebab-case.
- Use the product or feature area, not only a PR number.
- End every runbook with `-manual-test.md`.
- Keep PR or issue numbers in the document metadata, not as the primary filename.

Examples:

- `content-mediation-manual-test.md`
- `external-event-adapter-manual-test.md`
- `inngest-pipeline-trigger-manual-test.md`
- `profile-isolation-manual-test.md`

## Document Schema

Each manual test runbook should use this structure:

```markdown
# <Feature Area> Manual Test

| Field | Value |
| --- | --- |
| Feature area | <feature or subsystem> |
| Related PR/issues | <PR/issue/spec links or IDs> |
| Environment | <local Docker Compose, staging, production, etc.> |
| Required services | <db, server, inngest, external service, etc.> |
| Required credentials | <MCP token, API key, JWT, none, etc.> |
| Last verified | <YYYY-MM-DD or Not yet verified> |

## Purpose

What this validates.

## Prerequisites

Tools, env vars, services, credentials, seed data, and setup assumptions.

## Steps

Numbered commands and actions in the order they should be run.

## Expected Results

Concrete pass criteria.

## Cleanup

Any local data, containers, env vars, test users, or files to remove.

## Troubleshooting

Known failure modes and fixes.
```

## Current Runbooks

| Runbook | Scope |
| --- | --- |
| [content-mediation-manual-test.md](content-mediation-manual-test.md) | `/api/mediation/*` session, JWT/JWKS, and cache-miss flows |
| [external-event-adapter-manual-test.md](external-event-adapter-manual-test.md) | `/v1/events/*` source, webhook, schedule, automation, health, and admin flows |
| [inngest-pipeline-trigger-manual-test.md](inngest-pipeline-trigger-manual-test.md) | Inngest local dev server and manual pipeline trigger smoke test |
| [meta-critic-hardening-manual-test.md](meta-critic-hardening-manual-test.md) | Playwright MCP auth hardening, MCP Playwright health, and audited MCP tool-call smoke checks |
| [profile-isolation-manual-test.md](profile-isolation-manual-test.md) | Profile isolation migration, no-engine generation stub, and profile smoke checks |
