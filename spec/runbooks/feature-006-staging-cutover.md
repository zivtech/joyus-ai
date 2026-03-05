# Feature 006 Staging Cutover Command Sheet

**Scope:** staging validation + rollback rehearsal for Feature 006 (`content` paths)  
**Precondition:** PR #2 and PR #3 are merged to `main`.

## 1. Preflight

1. Select release SHA and export context:
```bash
export RELEASE_SHA="<merge-commit-sha>"
export BASE_URL="https://<staging-host>"
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<db>"
```
2. Ensure required tools exist on runner/jumpbox: `git`, `npm`, `psql`, `curl`.
3. Optional for full mediation happy-path smoke:
```bash
export MEDIATION_API_KEY="<staging-api-key>"
export MEDIATION_BEARER_TOKEN="<staging-user-jwt>"
export MEDIATION_PROFILE_ID="<profile-id-optional>"
```

## 2. Deploy Candidate

```bash
git fetch origin
git checkout "$RELEASE_SHA"
cd joyus-ai-mcp-server
npm ci
npm run build
```

Deploy using your staging release mechanism (container rollout/systemd/etc).

## 3. Apply/Verify Schema State

1. Run schema sync for current model:
```bash
cd joyus-ai-mcp-server
npm run db:push
```
2. Confirm content schema objects + query plan:
```bash
cd ..
./deploy/scripts/feature-006-search-vector-check.sh
```

## 4. Smoke Test Staging

```bash
./deploy/scripts/feature-006-smoke.sh
```

Minimum pass conditions:
- `/api/content/health` returns 200
- `/api/content/metrics` returns 200
- `/api/mediation/health` returns 200
- auth negative-path checks return expected 401 codes
- if credentials provided: create session, send message, close session all succeed

## 5. Rollback Rehearsal

1. Capture current stable SHA before release:
```bash
export PREVIOUS_SHA="<known-good-sha>"
```
2. Trigger rollback to previous SHA using same staging deploy mechanism.
3. Re-run smoke:
```bash
./deploy/scripts/feature-006-smoke.sh
```
4. Record rollback time-to-recovery and any manual actions required.

## 6. Evidence to Attach to Release Record

- Output from `feature-006-search-vector-check.sh`
- Output from `feature-006-smoke.sh`
- Release SHA + rollback SHA
- Any query-plan anomalies and remediation notes

## 7. Exit Criteria

Feature 006 staging cutover is complete when:
1. Schema sync succeeded without manual hotfix SQL.
2. Search-vector check passes with valid plan output.
3. Smoke script passes.
4. Rollback rehearsal succeeds and service health is restored.
