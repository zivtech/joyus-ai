# Anthropic Provider Manual Test

Use these steps to verify the Anthropic generation provider with a real API key.
Do not commit or paste real API keys, MCP tokens, or OAuth secrets into issues, PRs, or logs.

## 1. Configure local environment

From the repository root:

```bash
cd joyus-ai-mcp-server
cp .env.example .env
```

Edit `.env` and set:

```env
ANTHROPIC_API_KEY=<your Anthropic API key>
JOYUS_ANTHROPIC_MODEL=claude-sonnet-4-6
```

## 2. Start dependencies and server

Use one of the following startup paths. If you see `ERR_MODULE_NOT_FOUND` for a package such as `inngest`, rebuild or reinstall dependencies because the running environment has stale `node_modules`.

### Option A: Docker Compose server

Rebuild the server image so `npm ci` installs dependencies from the current lockfile, then start the stack:

```bash
docker compose up --build
```

### Option B: Local server with Docker Postgres

Install local dependencies, start only Postgres in Docker, apply the schema, and run the server locally:

```bash
npm ci
docker compose up -d db
npm run db:migrate
npm run dev
```

Expected startup evidence:

```text
[content] Generation provider: Anthropic
```

If startup logs show `Placeholder`, confirm `ANTHROPIC_API_KEY` is present in the environment used by the server process.

## 3. Verify health endpoint

In a second terminal:

```bash
curl -i http://localhost:3000/health/platform
```

Expected result: HTTP 200 health response.

## 4. Verify MCP authentication behavior

Missing token should be rejected:

```bash
curl -i http://localhost:3000/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Expected result: HTTP 401.

If you have a valid local MCP token, export it without printing it:

```bash
export MCP_TOKEN="<your local MCP bearer token>"
```

Then verify authenticated MCP initialization:

```bash
curl -i http://localhost:3000/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}'
```

Expected result: request is not rejected as missing/invalid authorization.

## 5. Run a direct Anthropic provider smoke test

Build the package:

```bash
npm run build
```

Create a temporary smoke-test script outside the repo:

```bash
cat > /tmp/test-anthropic-provider.mjs <<'SCRIPT'
import { pathToFileURL } from 'node:url';

const providerUrl = new URL(
  'dist/content/generation/anthropic-provider.js',
  pathToFileURL(`${process.cwd()}/`)
);
const { AnthropicGenerationProvider } = await import(providerUrl);

const provider = new AnthropicGenerationProvider({
  model: process.env.JOYUS_ANTHROPIC_MODEL,
  timeoutMs: 120000,
  maxRetries: 2,
});

const result = await provider.generate(
  'Answer in one short sentence: what is 2 + 2?',
  'You are a concise test assistant.'
);

console.log(result);
SCRIPT
```

Run it from `joyus-ai-mcp-server/` so the relative `./dist/...` import resolves:

```bash
node /tmp/test-anthropic-provider.mjs
```

Expected result: a real Anthropic response, for example `2 + 2 = 4.`

## 6. Optional fallback check

Unset the API key and restart the server:

```bash
unset ANTHROPIC_API_KEY
npm run dev
```

Expected startup evidence:

```text
[content] Generation provider: Placeholder
```

Restore `ANTHROPIC_API_KEY` before continuing provider validation.

## PR test-plan note

Use a summary like this in the PR, without secrets:

```md
Manual Anthropic provider test:
- Set ANTHROPIC_API_KEY locally and JOYUS_ANTHROPIC_MODEL=claude-sonnet-4-6.
- Started joyus-ai-mcp-server and confirmed startup log: [content] Generation provider: Anthropic.
- Verified /health/platform returns HTTP 200.
- Verified missing MCP bearer token returns HTTP 401.
- Ran direct AnthropicGenerationProvider smoke test and received a real model response.
```
