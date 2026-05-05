# PR #33 Manual Testing Steps

These steps validate the Inngest migration changes for PR #33, especially manual pipeline triggering through `pipelineId`.

## 1. Enter the server directory

```bash
cd /home/jdelaigle/Work/infrastructure/joyus-ai/joyus-ai-mcp-server
```

## 2. Install dependencies if needed

```bash
npm install
```

## 3. Run local verification

```bash
npm run typecheck
npm test
npm run lint
```

Expected results:

- TypeScript exits with `0` errors.
- Vitest passes all test files.
- ESLint exits `0`. Existing warnings are acceptable if no errors are reported.

## 4. Start local services

If testing against local PostgreSQL and self-hosted Inngest:

```bash
docker compose up -d postgres
docker compose -f docker-compose.inngest.yml up -d
```

## 5. Apply database migrations

```bash
npm run db:migrate
```

## 6. Start the MCP server

```bash
npm run dev
```

## 7. Confirm health endpoints

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/db
```

Expected results:

- `/health` returns a JSON response.
- `/health/db` reports database connectivity as `ok`.

## 8. Confirm the Inngest endpoint is mounted

```bash
curl -i http://localhost:3000/api/inngest
```

Expected result:

- The endpoint responds, confirming the Inngest handler is mounted.

## 9. Open the Inngest dev UI

If using the local Inngest dev server, open:

```text
http://localhost:8288
```

Expected result:

- Inngest UI loads.
- Registered functions include `manual-trigger-pipeline`.

## 10. Trigger a manual pipeline

Use a valid bearer token and an existing active pipeline ID:

```bash
curl -X POST http://localhost:3000/api/pipelines/<PIPELINE_ID>/trigger \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"payload":{"query":"manual smoke test"}}'
```

Expected result:

- HTTP status is `202`.
- Response JSON includes `eventId` and `pipelineId`.
- Inngest receives a `pipeline/manual.triggered` event.
- `manual-trigger-pipeline` runs.
- The function loads the pipeline by `pipelineId`.
- The function executes the stored ordered pipeline steps/config, not a hardcoded step sequence.

## 11. Check execution history

```bash
curl http://localhost:3000/api/pipelines/<PIPELINE_ID>/executions \
  -H "Authorization: Bearer <TOKEN>"
```

Expected result:

- A new execution appears for the triggered pipeline.
- Status is one of:
  - `completed`
  - `paused_at_gate`
  - `paused_on_failure`

The exact status depends on the stored pipeline steps and their configuration.

## 12. Optional: verify no deleted custom plumbing remains

From the repository root:

```bash
cd /home/jdelaigle/Work/infrastructure/joyus-ai

grep -R "pipelines/engine\|pipelines/event-bus\|pipelines/triggers\|initializePipelineModule\|eventBus\.publish" \
  -n joyus-ai-mcp-server/src joyus-ai-mcp-server/tests || true
```

Expected result:

- No output.

## Notes

- Manual trigger execution is intentionally `pipelineId`-driven. This ensures the runtime executes the actual stored pipeline definition and configuration instead of an assumed hardcoded sequence.
- A live self-hosted Inngest plus PostgreSQL smoke test is the strongest manual validation for this PR.
