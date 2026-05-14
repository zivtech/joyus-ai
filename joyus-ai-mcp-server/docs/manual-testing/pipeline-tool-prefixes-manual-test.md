# Pipeline Tool Prefixes Manual Test

| Field | Value |
| --- | --- |
| Feature area | MCP pipeline tool naming |
| Related PR/issues | Issue #36 |
| Environment | Local Docker Compose and local MCP server |
| Required services | PostgreSQL, MCP server |
| Required credentials | MCP bearer token |
| Last verified | Not yet verified |

## Purpose

Validate that pipeline-domain MCP tools use the `pipeline_` namespace after the
tool rename. This runbook checks that new tool names are advertised and
callable, old unprefixed tool names are absent and rejected, and
`pipeline_template_instantiate` works end to end against a disposable local
template.

## Prerequisites

- Node.js 20+
- Docker Compose
- `jq`
- Local `.env` configured for the MCP server, or enough environment values set
  for local development.
- This runbook assumes the default local database settings:
  `POSTGRES_USER=postgres`, `POSTGRES_DB=joyus_ai_mcp`.

## Steps

1. Start the local database.

   ```bash
   cd joyus-ai-mcp-server
   docker compose up -d db
   ```

2. Apply the database schema.

   ```bash
   npm run db:push
   ```

3. Start the local MCP server with the development auth bypass enabled.

   ```bash
   ENABLE_DEV_AUTH_BYPASS=true npm run dev
   ```

   Leave this process running.

4. In a browser, create or load a local user session.

   ```text
   http://localhost:3000/auth/dev-login
   ```

   Copy the MCP bearer token shown on the `/auth` page. If the token is masked,
   regenerate it and copy the newly displayed token.

5. In a second terminal, set local test variables.

   ```bash
   cd joyus-ai-mcp-server
   export MCP_BASE_URL="http://localhost:3000"
   export MCP_TOKEN="<paste MCP bearer token>"
   ```

6. Seed one disposable built-in pipeline template.

   ```bash
   docker compose exec -T db psql \
     -U "${POSTGRES_USER:-postgres}" \
     -d "${POSTGRES_DB:-joyus_ai_mcp}" <<'SQL'
   insert into pipelines.pipeline_templates (
     id, tenant_id, name, description, category, definition,
     parameters, assumptions, version, is_active
   )
   values (
     'manual-test-template',
     null,
     'Manual Test Template',
     'Manual smoke-test template',
     'manual',
     '{
       "triggerType": "manual_request",
       "triggerConfig": { "type": "manual_request" },
       "steps": [
         {
           "name": "Notify",
           "stepType": "notification",
           "config": { "channel": "email", "message": "Manual test" }
         }
       ]
     }'::jsonb,
     '{}'::jsonb,
     '[]'::jsonb,
     1,
     true
   )
   on conflict (name) do update
   set definition = excluded.definition,
       is_active = true,
       updated_at = now();
   SQL
   ```

7. List MCP tools and save the response.

   ```bash
   curl -sS -X POST "$MCP_BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":"tools-list","method":"tools/list","params":{}}' \
     > /tmp/joyus-tools.json
   ```

8. Confirm the new `pipeline_` tool names are advertised.

   ```bash
   jq -r '.result.tools[].name' /tmp/joyus-tools.json \
     | sort \
     | grep -E '^(pipeline_review_decide|pipeline_template_list|pipeline_template_instantiate)$'
   ```

   Expected output:

   ```text
   pipeline_review_decide
   pipeline_template_instantiate
   pipeline_template_list
   ```

9. Confirm the old tool names are not advertised.

   ```bash
   jq -r '.result.tools[].name' /tmp/joyus-tools.json \
     | grep -E '^(review_decide|template_list|template_instantiate)$'
   ```

   Expected output: no output.

10. Call `pipeline_template_list`.

    ```bash
    curl -sS -X POST "$MCP_BASE_URL/mcp" \
      -H "Authorization: Bearer $MCP_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":"template-list","method":"tools/call","params":{"name":"pipeline_template_list","arguments":{"category":"manual"}}}' \
      > /tmp/template-list.json

    jq -r '.result.content[0].text' /tmp/template-list.json | jq .
    ```

    Expected result: the JSON includes `manual-test-template`.

11. Call `pipeline_template_instantiate`.

    ```bash
    export PIPELINE_NAME="Manual Smoke $(date +%s)"

    curl -sS -X POST "$MCP_BASE_URL/mcp" \
      -H "Authorization: Bearer $MCP_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg name "$PIPELINE_NAME" '{
        jsonrpc: "2.0",
        id: "template-instantiate",
        method: "tools/call",
        params: {
          name: "pipeline_template_instantiate",
          arguments: {
            templateId: "manual-test-template",
            name: $name
          }
        }
      }')" \
      > /tmp/template-instantiate.json

    jq -r '.result.content[0].text' /tmp/template-instantiate.json | jq .
    ```

    Expected result:

    - `templateId` is `manual-test-template`
    - `templateName` is `Manual Test Template`
    - `pipeline.name` matches `$PIPELINE_NAME`
    - `pipeline.steps[0].name` is `Notify`

12. Confirm the instantiated pipeline is visible through `pipeline_list`.

    ```bash
    curl -sS -X POST "$MCP_BASE_URL/mcp" \
      -H "Authorization: Bearer $MCP_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":"pipeline-list","method":"tools/call","params":{"name":"pipeline_list","arguments":{}}}' \
      > /tmp/pipeline-list.json

    jq -r '.result.content[0].text' /tmp/pipeline-list.json \
      | jq --arg name "$PIPELINE_NAME" '.pipelines[] | select(.name == $name)'
    ```

    Expected result: one pipeline row for `$PIPELINE_NAME`.

13. Confirm old tool calls fail with `Unknown tool`.

    ```bash
    for TOOL in template_list template_instantiate review_decide; do
      curl -sS -X POST "$MCP_BASE_URL/mcp" \
        -H "Authorization: Bearer $MCP_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg tool "$TOOL" '{
          jsonrpc: "2.0",
          id: $tool,
          method: "tools/call",
          params: { name: $tool, arguments: {} }
        }')" \
        > "/tmp/${TOOL}.json"

      echo "$TOOL:"
      jq '.result.isError' "/tmp/${TOOL}.json"
      jq -r '.result.content[0].text' "/tmp/${TOOL}.json"
    done
    ```

    Expected result for each tool:

    - `isError` is `true`
    - the error text is `Error: Unknown tool: <old-name>`

14. Confirm `pipeline_review_decide` routes to the pipeline executor.

    This uses a missing decision ID on purpose. The expected failure proves the
    tool reached `DecisionRecorder` instead of failing at top-level dispatch.

    ```bash
    curl -sS -X POST "$MCP_BASE_URL/mcp" \
      -H "Authorization: Bearer $MCP_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":"review-decide","method":"tools/call","params":{"name":"pipeline_review_decide","arguments":{"decisionId":"missing-decision","status":"approved"}}}' \
      > /tmp/review-decide.json

    jq '.result.isError' /tmp/review-decide.json
    jq -r '.result.content[0].text' /tmp/review-decide.json
    ```

    Expected result:

    - `isError` is `true`
    - error text includes `Review decision not found: missing-decision`
    - error text does not include `Unknown tool`

## Expected Results

- `tools/list` includes:
  - `pipeline_review_decide`
  - `pipeline_template_list`
  - `pipeline_template_instantiate`
- `tools/list` does not include:
  - `review_decide`
  - `template_list`
  - `template_instantiate`
- `pipeline_template_list` returns the seeded manual template.
- `pipeline_template_instantiate` creates a pipeline from the seeded template.
- `pipeline_list` returns the newly instantiated pipeline.
- Old tool names return `Unknown tool`.
- `pipeline_review_decide` reaches the review decision layer and returns
  `Review decision not found` for the deliberate missing ID.

## Cleanup

Remove the disposable pipeline and template from the local database.

```bash
docker compose exec -T db psql \
  -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-joyus_ai_mcp}" <<'SQL'
delete from pipelines.pipelines
where template_id = 'manual-test-template'
   or name like 'Manual Smoke %';

delete from pipelines.pipeline_templates
where id = 'manual-test-template'
   or name = 'Manual Test Template';
SQL
```

Optional local temp-file cleanup:

```bash
rm -f /tmp/joyus-tools.json \
  /tmp/template-list.json \
  /tmp/template-instantiate.json \
  /tmp/pipeline-list.json \
  /tmp/template_list.json \
  /tmp/template_instantiate.json \
  /tmp/review_decide.json \
  /tmp/review-decide.json
```

## Troubleshooting

- `401 Unauthorized`: Confirm `MCP_TOKEN` was copied from the local `/auth`
  page and is exported in the current shell.
- `Cannot find module` or TypeScript startup errors: run `npm install` from
  `joyus-ai-mcp-server`.
- Database connection errors: confirm `docker compose up -d db` completed and
  `DATABASE_URL` points to the local database.
- `relation "pipelines.pipeline_templates" does not exist`: run
  `npm run db:push`.
- `jq: command not found`: install `jq`, or inspect the saved JSON files
  manually.
- `pipeline_template_list` returns no templates: rerun the seed step and confirm
  it completed without SQL errors.
