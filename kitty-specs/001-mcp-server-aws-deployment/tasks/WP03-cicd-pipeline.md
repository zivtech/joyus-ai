---
work_package_id: WP03
title: CI/CD Pipeline
lane: "done"
dependencies: []
base_branch: 001-mcp-server-aws-deployment-WP02
base_commit: 0de5a7aba398cf00ca6499c97791604b0f842fb5
created_at: '2026-02-19T01:55:07.685866+00:00'
subtasks: [T011, T012, T013, T014, T015]
shell_pid: "40410"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP03: CI/CD Pipeline

**Implement with**: `spec-kitty implement WP03 --base WP02`

## Objective

Create the GitHub Actions workflow that builds Docker images, pushes them to GHCR, and deploys to EC2 on every push to main. Includes rollback on health check failure and Slack notification on deploy success/failure.

## Context

- **Dependencies**: WP01 (Dockerfiles), WP02 (EC2 setup + nginx)
- **Registry**: GitHub Container Registry (GHCR) — free tier, migrate to ECR later
- **Trigger**: Push to `main` branch, scoped to `deploy/`, `joyus-ai-mcp-server/`, `web-chat/` paths
- **Target**: EC2 instance accessible via SSH from GitHub Actions runner
- **Reference**: See `plan.md` CI/CD Pipeline section and `quickstart.md` Deploy section

## Subtasks

### T011: Create GitHub Actions Workflow for CI/CD

**Purpose**: Define the end-to-end pipeline from code push to production deployment.

**Steps**:
1. Create `.github/workflows/deploy-mcp.yml`:
   ```yaml
   name: Deploy MCP Server

   on:
     push:
       branches: [main]
       paths:
         - 'deploy/**'
         - 'joyus-ai-mcp-server/**'
         - 'web-chat/**'
         - '.github/workflows/deploy-mcp.yml'

   concurrency:
     group: deploy-production
     cancel-in-progress: false

   env:
     REGISTRY: ghcr.io
     PLATFORM_IMAGE: ghcr.io/zivtech/joyus-ai-platform
     PLAYWRIGHT_IMAGE: ghcr.io/zivtech/joyus-ai-playwright

   jobs:
     build-and-push:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         packages: write
       steps:
         - uses: actions/checkout@v4

         - name: Log in to GHCR
           uses: docker/login-action@v3
           with:
             registry: ghcr.io
             username: ${{ github.actor }}
             password: ${{ secrets.GITHUB_TOKEN }}

         - name: Set up Docker Buildx
           uses: docker/setup-buildx-action@v3

         - name: Build and push Platform image
           uses: docker/build-push-action@v5
           with:
             context: .
             file: deploy/Dockerfile.platform
             push: true
             tags: |
               ${{ env.PLATFORM_IMAGE }}:latest
               ${{ env.PLATFORM_IMAGE }}:${{ github.sha }}
             cache-from: type=gha
             cache-to: type=gha,mode=max

         - name: Build and push Playwright image
           uses: docker/build-push-action@v5
           with:
             context: .
             file: deploy/Dockerfile.playwright
             push: true
             tags: |
               ${{ env.PLAYWRIGHT_IMAGE }}:latest
               ${{ env.PLAYWRIGHT_IMAGE }}:${{ github.sha }}
             cache-from: type=gha
             cache-to: type=gha,mode=max

     deploy:
       needs: build-and-push
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Deploy to EC2
           uses: appleboy/ssh-action@v1
           with:
             host: ${{ secrets.EC2_HOST }}
             username: ${{ secrets.EC2_USER }}
             key: ${{ secrets.EC2_SSH_KEY }}
             script: |
               cd /opt/joyus-ai
               ./deploy/scripts/deploy.sh ${{ github.sha }}
   ```
2. Use `concurrency` to prevent overlapping deployments
3. Use Docker layer caching via GitHub Actions cache (`type=gha`)
4. Separate `build-and-push` and `deploy` jobs for clarity

**Files**:
- `.github/workflows/deploy-mcp.yml` (new, ~80 lines)

**Validation**:
- [ ] Workflow triggers on push to main with correct path filters
- [ ] GHCR login succeeds with GITHUB_TOKEN
- [ ] Both images build and push successfully
- [ ] Deploy job runs only after build succeeds
- [ ] Concurrent deploys prevented by concurrency group

---

### T012: Configure GHCR Image Build and Push

**Purpose**: Ensure images are tagged with both `latest` and the git SHA for rollback capability.

**Steps**:
1. Each image gets two tags on every build:
   - `ghcr.io/zivtech/joyus-ai-platform:latest` — current production
   - `ghcr.io/zivtech/joyus-ai-platform:<git-sha>` — immutable rollback point
2. Same pattern for Playwright image
3. Docker Buildx with GHA cache for faster builds:
   - First build may take 5-10 minutes
   - Subsequent builds with cache: 1-3 minutes
4. Verify GHCR package visibility is set appropriately (organization-level, not public)

**Files**:
- Part of `.github/workflows/deploy-mcp.yml` (build steps)

**Validation**:
- [ ] `docker pull ghcr.io/zivtech/joyus-ai-platform:latest` works
- [ ] `docker pull ghcr.io/zivtech/joyus-ai-platform:<sha>` works for specific commit
- [ ] GHCR packages visible under zivtech org
- [ ] Build cache reduces subsequent build times

**Edge Cases**:
- GHCR free tier has storage limits — old SHA tags accumulate. Consider a cleanup workflow (not in this phase, note for future).
- GITHUB_TOKEN must have `packages: write` permission (set in workflow permissions)

---

### T013: Write Deployment Script (`deploy.sh`)

**Purpose**: Script executed on EC2 that pulls new images, restarts services, and verifies health.

**Steps**:
1. Create `deploy/scripts/deploy.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SHA="${1:-latest}"
   COMPOSE_DIR="/opt/joyus-ai"
   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

   cd "$COMPOSE_DIR"

   echo "=== Deploying SHA: $SHA ==="

   # Save current image SHAs for rollback
   PREV_PLATFORM=$(docker inspect --format='{{.Image}}' joyus-ai-platform-1 2>/dev/null || echo "none")
   PREV_PLAYWRIGHT=$(docker inspect --format='{{.Image}}' joyus-ai-playwright-1 2>/dev/null || echo "none")

   # Pull new images
   docker compose $COMPOSE_FILES pull

   # Bring up with new images
   docker compose $COMPOSE_FILES up -d

   # Wait for services to start
   sleep 10

   # Run health check
   if ./deploy/scripts/health-check.sh; then
     echo "=== Deploy successful ==="
     exit 0
   else
     echo "=== Health check failed! Rolling back ==="
     # Rollback logic (see T014)
     exit 1
   fi
   ```
2. Accept SHA as argument (defaults to `latest`)
3. Save previous image references before pulling new ones
4. Wait for container startup before health check
5. Exit with non-zero on failure (triggers Slack alert in CI)

**Files**:
- `deploy/scripts/deploy.sh` (new, ~60 lines)

**Validation**:
- [ ] Script is executable (`chmod +x`)
- [ ] Pulls and restarts all containers
- [ ] Health check runs after restart
- [ ] Non-zero exit on health check failure
- [ ] Previous image references saved for rollback

---

### T014: Implement Rollback Mechanism

**Purpose**: On health check failure, automatically revert to previous working images.

**Steps**:
1. In `deploy.sh`, add rollback logic after health check failure:
   ```bash
   rollback() {
     echo "Rolling back to previous images..."

     # Stop current containers
     docker compose $COMPOSE_FILES down

     # If we have a previous SHA, use it
     if [ -f /opt/joyus-ai/.last-good-sha ]; then
       ROLLBACK_SHA=$(cat /opt/joyus-ai/.last-good-sha)
       echo "Rolling back to SHA: $ROLLBACK_SHA"
       # Update compose override with pinned SHA tags
       sed -i "s|:latest|:${ROLLBACK_SHA}|g" docker-compose.prod.yml
       docker compose $COMPOSE_FILES pull
       docker compose $COMPOSE_FILES up -d
       # Restore :latest tags in file
       sed -i "s|:${ROLLBACK_SHA}|:latest|g" docker-compose.prod.yml
     else
       echo "No previous good SHA found. Starting with cached images."
       docker compose $COMPOSE_FILES up -d
     fi
   }
   ```
2. On successful deploy, save current SHA to `/opt/joyus-ai/.last-good-sha`
3. On failed deploy, read `.last-good-sha` and pull those tagged images
4. PostgreSQL data volume is never affected by rollback (persistent)

**Files**:
- Updates to `deploy/scripts/deploy.sh` (rollback function)

**Validation**:
- [ ] `.last-good-sha` file written after successful deployment
- [ ] Rollback triggers on health check failure
- [ ] Previous version starts successfully after rollback
- [ ] PostgreSQL data preserved through rollback
- [ ] Rollback status is communicated via exit code

**Edge Cases**:
- First deployment has no `.last-good-sha` — handle gracefully (restart with cached images)
- If rollback also fails — log and exit with error (manual intervention required)
- sed replacement is fragile — consider using environment variable substitution instead

---

### T015: Add Slack Notification on Deploy Success/Failure

**Purpose**: Notify the team in Slack when a deployment succeeds or fails.

**Steps**:
1. Add a notification job to the GitHub Actions workflow:
   ```yaml
   notify:
     needs: deploy
     if: always()
     runs-on: ubuntu-latest
     steps:
       - name: Notify Slack
         uses: 8398a7/action-slack@v3
         with:
           status: ${{ needs.deploy.result }}
           fields: repo,message,commit,author,action,workflow
         env:
           SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
   ```
2. Send on both success and failure (`if: always()`)
3. Include: repo name, commit message, author, deployment result
4. Use a Slack incoming webhook (simpler than bot token for CI notifications)
5. Configure webhook to post to `#deployments` or `#alerts` channel

**Files**:
- Updates to `.github/workflows/deploy-mcp.yml` (notify job)

**Validation**:
- [ ] Slack notification sent on successful deploy
- [ ] Slack notification sent on failed deploy
- [ ] Notification includes commit info and status
- [ ] Webhook URL stored as GitHub secret (not in code)

**Edge Cases**:
- Slack webhook URL must be created and added as GitHub secret before first use
- If Slack is down, notification failure should not fail the overall workflow (`continue-on-error: true`)

## Definition of Done

- [ ] Push to main triggers automated build and deploy
- [ ] Both Docker images pushed to GHCR with SHA tags
- [ ] Deployment script pulls, restarts, and health-checks
- [ ] Failed health check triggers automatic rollback
- [ ] Slack notification on success and failure
- [ ] New version live within 10 minutes of push

## Risks

- **GitHub Actions SSH key**: EC2_SSH_KEY must be in GitHub secrets. Document the key generation and upload process.
- **GHCR storage**: SHA-tagged images accumulate. Free tier has generous limits but plan for cleanup.
- **Workflow scope**: `gh auth refresh -h github.com -s workflow` needed for pushing workflow files via HTTPS.
- **First deploy**: No `.last-good-sha` exists — rollback falls back to cached images.

## Activity Log

- 2026-02-19T01:57:34Z – unknown – shell_pid=40410 – lane=for_review – GitHub Actions workflow, deploy script with rollback, health check script
- 2026-02-19T01:57:42Z – unknown – shell_pid=40410 – lane=done – Review passed: CI/CD pipeline, deploy with rollback, health checks
