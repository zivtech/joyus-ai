# Control-Plane Staging Checklist

Use this checklist before promoting any control-plane contract changes to production.

## Preconditions

1. Staging host has latest repo checkout at `/opt/joyus-ai`.
2. Staging `.env` is present and points to staging infrastructure.
3. `STAGING_BASE_URL` resolves to the staging MCP API (for example `https://staging.api.joyus.ai`).

## Required Run

From the staging host:

```bash
cd /opt/joyus-ai
export STAGING_BASE_URL="https://staging.api.joyus.ai"
./deploy/scripts/staging-migrate-and-smoke.sh
```

This run performs:

1. `npm run db:migrate` in `joyus-ai-mcp-server`.
2. Control-plane test gate:
   - `tests/control-plane.service.test.ts`
   - `tests/control-plane.router.test.ts`
   - `tests/control-plane-executor.test.ts`
   - `tests/mcp.control-plane.integration.test.ts`
3. Smoke checks:
   - `/health`
   - `/health/platform`
   - `/health/playwright`
   - `/health/db`

## Promotion Rule

Production deploy is blocked unless the staging checklist run succeeds in CI (`deploy-mcp` workflow `staging-preflight` job).
