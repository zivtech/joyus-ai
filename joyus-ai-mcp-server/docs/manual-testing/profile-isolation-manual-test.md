# Profile Isolation Manual Test

| Field | Value |
| --- | --- |
| Feature area | Profile isolation and generation |
| Related PR/issues | PR #43, issue #67 |
| Environment | Local Docker Compose |
| Required services | PostgreSQL, MCP server |
| Required credentials | MCP bearer token |
| Last verified | 2026-05-11 |

## Purpose

These are the manual follow-up steps for PR #43 after the profile isolation fixes are committed.

## 1. Commit and Push the Rebased Branch

The branch was rebased onto `main`, so updating the PR branch requires a lease-protected force push.

```bash
git status --short
git add joyus-ai-mcp-server
git commit
git push --force-with-lease origin feat/008-profile-isolation
```

## 2. Apply the Profile Migration

Run migrations in each target environment before using profile generation.

```bash
cd joyus-ai-mcp-server
export NVM_DIR="$HOME/.config/nvm"
. "$NVM_DIR/nvm.sh"
nvm use

export DATABASE_URL="postgres://..."
npm run db:check
npm run db:migrate
```

Expected migration file:

```text
drizzle/migrations/0004_profile_isolation.sql
```

## 3. Rebuild Local Docker Dependencies

For local Docker Compose development, rebuild the server image after pulling this branch. The compose service bind-mounts `src` and `drizzle`, but `node_modules` is baked into the image. A stale image can start with new source code and old dependencies, causing errors such as:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mammoth'
```

```bash
cd joyus-ai-mcp-server
docker compose build server
docker compose up server
```

If Docker keeps reusing an old dependency layer, force a clean rebuild of just the server image:

```bash
cd joyus-ai-mcp-server
docker compose build --no-cache server
docker compose up server
```

## 4. Profile Engine Boundary

Feature 008 expects a separately deployed profile engine runtime. That engine is not included in this public repository. The server-to-engine contract is documented in `../profile-engine-contract.md`. If an engine is available in the target environment, configure its CLI command:

```bash
export PROFILE_ENGINE_COMMAND="joyus-profile"
export PROFILE_ENGINE_ARGS="generate"
export PROFILE_ENGINE_HEALTH_ARGS="health-check"
```

If the profile engine is not available, leave `PROFILE_ENGINE_COMMAND` unset and do not expect `profile_generate` to produce real profiles. The server should still boot, migrations should apply, and profile infrastructure should be testable. A `profile_generate` request should create a real generation run, mark it failed with a clear engine-not-configured error, and avoid creating fake profile rows.

## 5. Optional Profile Integration Test Run

The full local validation passed, but profile integration tests are skipped when `DATABASE_URL` is not set. Run them against a disposable database with the profile migration applied.

```bash
cd joyus-ai-mcp-server
export NVM_DIR="$HOME/.config/nvm"
. "$NVM_DIR/nvm.sh"
nvm use

export DATABASE_URL="postgres://..."
npm test -- tests/profiles/integration
```

## 6. Manual Smoke Check

### Server and Migration Checks

Confirm the server stays up after the dependency rebuild and migration run.

```bash
cd joyus-ai-mcp-server
docker compose logs server --tail=100
```

Confirm the `profiles` schema exists.

```bash
cd joyus-ai-mcp-server
docker compose exec db psql -U postgres -d joyus_ai_mcp \
  -c "\dt profiles.*"
```

Expected tables include:

```text
profiles.tenant_profiles
profiles.corpus_snapshots
profiles.corpus_documents
profiles.profile_inheritance
profiles.profile_cache
profiles.generation_runs
profiles.operation_logs
```

### No-Engine Generation Check

If `PROFILE_ENGINE_COMMAND` is unset, call `profile_generate` for a known tenant and corpus snapshot.

Step by step:

1. Set the local server URL and MCP bearer token.

   ```bash
   export BASE_URL="http://localhost:3000"
   export MCP_TOKEN="<paste MCP bearer token>"
   ```

   The curl examples below require `jq`. They unwrap the MCP response envelope and pretty-print the JSON returned by the tool.

2. List available corpus snapshots for the authenticated tenant.

   ```bash
   curl -sS -X POST "$BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @- <<'JSON' | jq -r '.result.content[0].text' | jq .
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "tools/call",
     "params": {
       "name": "profile_list_snapshots",
       "arguments": {
         "limit": 10
       }
     }
   }
   JSON
   ```

3. If the snapshot list is empty in local development, seed one smoke-test corpus document and snapshot for the same tenant as the MCP token.

   The profile tool executor currently uses the authenticated user ID as `tenantId`, so this derives `TENANT_ID` from the local `users` table and inserts matching rows into the `profiles` schema. Use this only for local manual smoke testing.

   ```bash
   # Run this from the joyus-ai-mcp-server directory.
   # If you are in the repo root, run: cd joyus-ai-mcp-server

   export TENANT_ID="$(
     docker compose exec -T db psql -U postgres -d joyus_ai_mcp \
       -Atc "select id from users where mcp_token = '$MCP_TOKEN' limit 1;"
   )"

   if [ -z "$TENANT_ID" ]; then
     echo "No user found for MCP_TOKEN. Confirm the token was copied from /auth for this local database."
     exit 1
   fi

   export DOC_ID="manual_doc_$(date +%s)"
   export SNAPSHOT_ID="manual_snapshot_$(date +%s)"
   export CONTENT_HASH="manual_hash_${DOC_ID}"
   export SNAPSHOT_NAME="manual-no-engine-smoke-${DOC_ID}"

   docker compose exec -T db psql -U postgres -d joyus_ai_mcp \
     -v tenant_id="$TENANT_ID" \
     -v doc_id="$DOC_ID" \
     -v snapshot_id="$SNAPSHOT_ID" \
     -v content_hash="$CONTENT_HASH" \
     -v snapshot_name="$SNAPSHOT_NAME" <<'SQL'
   insert into profiles.corpus_documents (
     id,
     tenant_id,
     content_hash,
     original_filename,
     format,
     title,
     author_id,
     author_name,
     extracted_text,
     word_count,
     data_tier,
     metadata,
     is_active
   ) values (
     :'doc_id',
     :'tenant_id',
     :'content_hash',
     'manual-profile-smoke.txt',
     'txt',
     'Manual profile smoke document',
     'author_001',
     'Manual Smoke Author',
     'This local smoke-test document gives the profile generation path an attributed corpus document. It is only intended to verify that profile_generate creates a failed no-engine generation run without creating fake profile rows.',
     31,
     1,
     '{"manualSmokeTest": true}'::jsonb,
     true
   );

   insert into profiles.corpus_snapshots (
     id,
     tenant_id,
     name,
     document_hashes,
     document_count,
     author_count,
     total_word_count
   ) values (
     :'snapshot_id',
     :'tenant_id',
     :'snapshot_name',
     jsonb_build_array(:'content_hash'),
     1,
     1,
     31
   );
   SQL
   ```

4. Copy a snapshot ID from the response, or use the `SNAPSHOT_ID` value created by the seed step.

   ```bash
   export SNAPSHOT_ID="<snapshot id>"
   ```

5. Optional: list available corpus documents to find tenant author IDs. Generation still filters those authors to documents in the selected snapshot.

   ```bash
   curl -sS -X POST "$BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @- <<'JSON' | jq -r '.result.content[0].text' | jq .
   {
     "jsonrpc": "2.0",
     "id": 2,
     "method": "tools/call",
     "params": {
       "name": "profile_list_documents",
       "arguments": {
         "limit": 20
       }
     }
   }
   JSON
   ```

6. Optional: set one author ID to target a single author. Skip this and use the all-authors call below if you want every author in the snapshot.

   ```bash
   export AUTHOR_ID="<author id>"
   ```

7. Generate one author profile.

   ```bash
   curl -sS -X POST "$BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @- <<JSON | jq -r '.result.content[0].text' | jq .
   {
     "jsonrpc": "2.0",
     "id": 3,
     "method": "tools/call",
     "params": {
       "name": "profile_generate",
       "arguments": {
         "corpusSnapshotId": "${SNAPSHOT_ID}",
         "authorIds": ["${AUTHOR_ID}"],
         "tier": "base"
       }
     }
   }
   JSON
   ```

8. Or generate for all authors in the snapshot.

   ```bash
   curl -sS -X POST "$BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @- <<JSON | jq -r '.result.content[0].text' | jq .
   {
     "jsonrpc": "2.0",
     "id": 4,
     "method": "tools/call",
     "params": {
       "name": "profile_generate",
       "arguments": {
         "corpusSnapshotId": "${SNAPSHOT_ID}",
         "tier": "base"
       }
     }
   }
   JSON
   ```

9. Copy the `runId` from the generation response and poll status.

   ```bash
   export RUN_ID="<run id>"

   curl -sS -X POST "$BASE_URL/mcp" \
     -H "Authorization: Bearer $MCP_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @- <<JSON | jq -r '.result.content[0].text' | jq .
   {
     "jsonrpc": "2.0",
     "id": 5,
     "method": "tools/call",
     "params": {
       "name": "profile_get_generation_status",
       "arguments": {
         "runId": "${RUN_ID}"
       }
     }
   }
   JSON
   ```

Verify:

- The response includes a non-empty `runId`.
- The response `status` is `failed`.
- `profilesRequested` is greater than zero.
- `profilesFailed` matches the requested profile count for the no-engine run.
- The error clearly says the profile engine is not configured.
- `profile_get_generation_status` returns the same `runId`.
- No fake profile rows are created.

Confirm the generation run was recorded.

```bash
cd joyus-ai-mcp-server
docker compose exec db psql -U postgres -d joyus_ai_mcp \
  -c "select id, tenant_id, status, error from profiles.generation_runs order by started_at desc limit 5;"
```

Confirm no fake active profiles were created by the no-engine run.

```bash
cd joyus-ai-mcp-server
docker compose exec db psql -U postgres -d joyus_ai_mcp \
  -c "select id, tenant_id, profile_identity, status from profiles.tenant_profiles;"
```

### Real Engine Check

Only run this check when issue #67 is resolved and a real `joyus-profile-engine` adapter is configured.

Verify:

- `profile_generate` returns `status: completed`.
- Generated profiles are scoped to documents in the selected corpus snapshot.
- Only one active profile exists per tenant/profile identity.
- Profile rows contain real `stylometric_features`, `markers`, `fidelity_score`, and `engine_version` metadata from the private engine.

### Pipeline Step Config Example

Use this only when testing the pipeline step surface, not when calling the MCP profile tool directly. The MCP tool is named `profile_generate`; the pipeline step type is named `profile_generation`.

```json
{
  "type": "profile_generation",
  "profileIds": ["base::author_001"],
  "forceRegenerate": false
}
```
