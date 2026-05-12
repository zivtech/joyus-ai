# Meta-Critic Hardening Manual Test

| Field | Value |
| --- | --- |
| Feature area | Meta-critic rebase hardening |
| Related PR/issues | Branch `fix/meta-critic-tiers-4-5`; commits `f4f538b`, `abfc275`, `9dbec23` |
| Environment | Local Docker Compose or staging |
| Required services | PostgreSQL, MCP server, Playwright MCP bridge |
| Required credentials | MCP bearer token, Playwright bridge bearer token |
| Last verified | Not yet verified |

## Environment Variables

Set these in the shell used for the curl requests. `PLAYWRIGHT_AUTH_TOKEN`
must match the token used when the Playwright bridge process was started.

```bash
# MCP server origin. Local Docker Compose default: http://localhost:3000.
export MCP_BASE_URL="http://localhost:3000"

# Playwright bridge origin. Local Docker Compose default: http://localhost:3002.
export PLAYWRIGHT_BASE_URL="http://localhost:3002"

# Local: copy from joyus-ai-mcp-server/.env.
# Staging/shared: get from the deployment owner or approved secret store.
export PLAYWRIGHT_AUTH_TOKEN="<same token configured on the Playwright bridge>"

# Any value that is definitely not the real PLAYWRIGHT_AUTH_TOKEN.
export WRONG_PLAYWRIGHT_AUTH_TOKEN="wrong-local-test-token"

# Browser: open $MCP_BASE_URL/auth, sign in, and copy the shown token.
# If masked, click "Regenerate MCP Token" and copy the newly displayed token.
export MCP_BEARER_TOKEN="<paste MCP bearer token from browser auth>"

# Curl: create the temporary tenant-discovery pipeline below and copy pipeline.tenantId.
export EXPORT_TENANT_ID="<tenant id allowed for your MCP user>"

# Curl: run the audited ops_export_excel tool call below and copy download_url.
export EXPORT_DOWNLOAD_URL="<paste download_url after the export call>"

# Curl: optional cleanup value from the tenant-discovery response, pipeline.id.
export TENANT_DISCOVERY_PIPELINE_ID="<paste temporary pipeline id if created>"
```

## Collect Required Values

Use this section when any placeholder above is unknown.

### MCP_BASE_URL

- [ ] Browser request: open the MCP server base URL for the environment under
  test.

Expected: use that origin as `MCP_BASE_URL`. Local Docker Compose usually uses
`http://localhost:3000`.

- [ ] Curl request: confirm the selected MCP base URL responds.

```bash
curl -i -sS "$MCP_BASE_URL/health/platform"
```

Expected: `HTTP 200` or `HTTP 503` with `"service":"platform"`. A connection
error means `MCP_BASE_URL` is wrong or the server is not running.

### PLAYWRIGHT_BASE_URL

- [ ] Browser request: open the Playwright bridge health URL for the environment
  under test.

Expected: local Docker Compose usually uses `http://localhost:3002/health`; if
that loads, set `PLAYWRIGHT_BASE_URL` to `http://localhost:3002`.

- [ ] Curl request: confirm the selected Playwright base URL responds.

```bash
curl -i -sS "$PLAYWRIGHT_BASE_URL/health"
```

Expected: `HTTP 200` with `"service":"playwright"`.

### PLAYWRIGHT_AUTH_TOKEN

There is intentionally no browser or curl endpoint that reveals this token.

- [ ] Local environment: use the exact `PLAYWRIGHT_AUTH_TOKEN` value exported
  before starting the Playwright bridge. If you are using this repo's local
  ignored `.env`, copy the `PLAYWRIGHT_AUTH_TOKEN` value from
  `joyus-ai-mcp-server/.env` into the shell running these manual checks.
- [ ] Shared/staging environment: get the exact configured
  `PLAYWRIGHT_AUTH_TOKEN` from the deployment owner or approved secret store.
- [ ] If the token cannot be obtained for a local stack, restart the local stack
  with a known `PLAYWRIGHT_AUTH_TOKEN` value and use that value here.

Expected: the same token is present in this shell and in the Playwright bridge
process environment.

### WRONG_PLAYWRIGHT_AUTH_TOKEN

- [ ] Set this to any value that is definitely not the configured
  `PLAYWRIGHT_AUTH_TOKEN`.

Expected: `wrong-local-test-token` is sufficient unless that is the real bridge
token.

### MCP_BEARER_TOKEN

- [ ] Browser request: open `$MCP_BASE_URL/auth`.

Expected: the auth portal loads.

- [ ] Browser request: sign in. If the token is masked, click
  **Regenerate MCP Token**, confirm the prompt, and copy the newly displayed
  token into `MCP_BEARER_TOKEN`.

Expected: the token is shown once after regeneration or first login.

- [ ] Curl request: confirm the token works before continuing.

```bash
curl -i -sS -X POST "$MCP_BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":"manual-token-check","method":"initialize","params":{}}'
```

Expected: `HTTP 200` with a JSON-RPC `result` and `serverInfo`.

### EXPORT_TENANT_ID

The export smoke test needs a tenant id allowed for the MCP user. Until formal
tenant resolution exists, the safest HTTP-only way to discover the current
tenant id is to create a temporary pipeline and copy its `tenantId`.

- [ ] Curl request: create a temporary tenant-discovery pipeline.

```bash
curl -i -sS -X POST "$MCP_BASE_URL/api/pipelines" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Manual Tenant Discovery",
    "triggerType": "manual_request",
    "triggerConfig": { "type": "manual_request" },
    "steps": [
      {
        "stepType": "notification",
        "name": "Placeholder Step",
        "config": {
          "type": "notification",
          "channel": "webhook",
          "message": "manual tenant discovery"
        }
      }
    ]
  }'
```

Expected: `HTTP 201` with `pipeline.tenantId` and `pipeline.id`.

- [ ] Copy `pipeline.tenantId` into `EXPORT_TENANT_ID`.
- [ ] Copy `pipeline.id` into `TENANT_DISCOVERY_PIPELINE_ID` if you want to
  delete the temporary pipeline after collecting the tenant id.

- [ ] Curl request: optionally delete the temporary tenant-discovery pipeline.

```bash
curl -i -sS -X DELETE "$MCP_BASE_URL/api/pipelines/$TENANT_DISCOVERY_PIPELINE_ID" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN"
```

Expected: `HTTP 204`.

### EXPORT_DOWNLOAD_URL

- [ ] Leave this blank until the audited MCP tool success step returns a
  `download_url`.
- [ ] Copy that returned `download_url` into `EXPORT_DOWNLOAD_URL` before
  running the generated export URL check.

## Purpose

This validates the manual HTTP surface for the meta-critic fixes:

- Playwright MCP bridge fails closed for non-health requests without a valid
  bearer token.
- MCP server can still reach the Playwright SSE health endpoint.
- MCP tool-call success and failure paths still return correctly while awaited
  audit writes are enabled.

The state-package branch verification and debounce fixes do not expose a curl
or browser surface; those remain covered by automated tests.

## Prerequisites

- The MCP server is running and reachable at `MCP_BASE_URL`.
- The Playwright bridge is running and reachable at `PLAYWRIGHT_BASE_URL`.
- The Playwright bridge was started with `PLAYWRIGHT_AUTH_TOKEN`.
- PostgreSQL is reachable by the MCP server.
- `EXPORT_TENANT_ID` is either the current MCP user's tenant/user id or a tenant
  explicitly allowed for that user in the environment.

## Steps

### 1. Browser Auth

- [ ] Browser request: if `MCP_BEARER_TOKEN` was not already collected and
  validated above, open the value of `$MCP_BASE_URL/auth`, sign in, and copy the
  displayed MCP bearer token into `MCP_BEARER_TOKEN`.

Expected: the auth page loads, sign-in succeeds, and a bearer token is available.

### 2. Playwright Bridge Auth

- [ ] Curl request: confirm the unauthenticated health endpoint remains open.

```bash
curl -i -sS "$PLAYWRIGHT_BASE_URL/health"
```

Expected: `HTTP 200` with `"status":"ok"` and `"service":"playwright"`.

- [ ] Browser request: open the value of `$PLAYWRIGHT_BASE_URL/sse`.

Expected: the page shows `event: endpoint` and keeps the SSE connection open.

- [ ] Curl request: confirm unauthenticated non-health requests are rejected.

```bash
curl -i -sS "$PLAYWRIGHT_BASE_URL/tools"
```

Expected: `HTTP 401` with `{"error":"Unauthorized"}`.

- [ ] Curl request: confirm the wrong bearer token is rejected.

```bash
curl -i -sS "$PLAYWRIGHT_BASE_URL/tools" \
  -H "Authorization: Bearer $WRONG_PLAYWRIGHT_AUTH_TOKEN"
```

Expected: `HTTP 401` with `{"error":"Unauthorized"}`.

- [ ] Curl request: confirm the configured bearer token is accepted.

```bash
curl -i -sS "$PLAYWRIGHT_BASE_URL/tools" \
  -H "Authorization: Bearer $PLAYWRIGHT_AUTH_TOKEN"
```

Expected: `HTTP 200` with tool definitions including `playwright_navigate` and
`playwright_screenshot`.

- [ ] Curl request: confirm an authenticated Playwright tool call succeeds.

```bash
curl -i -sS -X POST "$PLAYWRIGHT_BASE_URL/tool" \
  -H "Authorization: Bearer $PLAYWRIGHT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"tool":"playwright_navigate","args":{"url":"data:text/html,<title>Manual Auth Smoke</title><main>ok</main>"}}'
```

Expected: `HTTP 200` with `"title":"Manual Auth Smoke"` and a `contentLength`
greater than zero.

### 3. MCP Server Playwright Health

- [ ] Curl request: confirm the MCP server can reach the Playwright SSE probe.

```bash
curl -i -sS "$MCP_BASE_URL/health/playwright"
```

Expected: `HTTP 200` with `"status":"ok"`, `"service":"playwright"`,
`"check":"mcp_sse_transport"`, and `"endpoint":"/sse"`.

### 4. MCP Tool Calls And Awaited Audit Writes

- [ ] Curl request: confirm MCP bearer auth works for initialization.

```bash
curl -i -sS -X POST "$MCP_BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":"manual-initialize","method":"initialize","params":{}}'
```

Expected: `HTTP 200` with `"jsonrpc":"2.0"` and a `serverInfo` object.

- [ ] Curl request: exercise the audited MCP tool failure path.

```bash
curl -i -sS -X POST "$MCP_BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":"manual-audit-failure","method":"tools/call","params":{"name":"ops_manual_unsupported","arguments":{}}}'
```

Expected: `HTTP 200` with a JSON-RPC `result`, `"isError":true`, and text
containing `Unsupported ops tool`. If audit persistence is broken, this may
return a JSON-RPC internal error instead.

- [ ] Curl request: exercise the audited MCP tool success path.

```bash
curl -i -sS -X POST "$MCP_BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"jsonrpc\":\"2.0\",
    \"id\":\"manual-audit-success\",
    \"method\":\"tools/call\",
    \"params\":{
      \"name\":\"ops_export_excel\",
      \"arguments\":{
        \"tenant_id\":\"$EXPORT_TENANT_ID\",
        \"scope\":\"current_view\",
        \"locations\":\"current\"
      }
    }
  }"
```

Expected: `HTTP 200` with a JSON-RPC `result` whose text includes `export_id`,
`download_url`, and `"status":"ready"`. Copy the `download_url` value into
`EXPORT_DOWNLOAD_URL`.

- [ ] Curl request: confirm the generated export URL is usable.

```bash
curl -I -sS "$EXPORT_DOWNLOAD_URL"
```

Expected: `HTTP 200` and an Excel workbook content type or downloadable file
response.

## Expected Results

- Health and SSE compatibility endpoints remain reachable without a bearer
  token.
- Playwright bridge non-health endpoints reject missing or wrong bearer tokens.
- Playwright bridge accepts the configured bearer token.
- MCP `/health/playwright` reports the Playwright SSE probe as healthy.
- MCP audited failure and success tool-call paths return JSON-RPC results rather
  than internal audit-write errors.

## Cleanup

No curl-only cleanup is required. Generated export download tokens expire based
on `EXPORT_SIGNED_URL_TTL_SECONDS`, which defaults to 900 seconds.

## Troubleshooting

- `HTTP 401` from authenticated Playwright requests: confirm the shell
  `PLAYWRIGHT_AUTH_TOKEN` exactly matches the token used to start the bridge.
- `HTTP 503` from `/health/playwright`: confirm the MCP server can resolve and
  reach the Playwright bridge URL configured by `PLAYWRIGHT_MCP_BASE_URL`.
- `Executable doesn't exist at /ms-playwright/...`: rebuild the Playwright
  image. The Dockerfile must use the same Playwright image version and npm
  package version.
- `User ... is not authorized for tenant ...`: set `EXPORT_TENANT_ID` to a
  tenant allowed for the MCP user, or run the server with an explicit local test
  allowlist.
- JSON-RPC internal errors during MCP tool calls: check MCP server logs for
  audit table or database connectivity failures.
- `Failed to spawn workbook exporter: spawn python3 ENOENT`: rebuild the MCP
  server image so the container includes the Python workbook exporter runtime.
