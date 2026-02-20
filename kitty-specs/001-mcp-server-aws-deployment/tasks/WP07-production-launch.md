---
work_package_id: WP07
title: Production Launch & Validation
lane: planned
dependencies: []
subtasks: [T033, T034, T035, T036, T037, T038]
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP07: Production Launch & Validation

**Implement with**: `spec-kitty implement WP07 --base WP06`

## Objective

Provision the real EC2 instance, configure DNS, set GitHub Actions secrets, perform the first production deployment, and validate with real team members connecting via Claude Desktop and web chat from a mobile device.

## Context

- **Dependencies**: ALL previous work packages (WP01-WP06)
- **This is the go-live work package** — real infrastructure, real DNS, real users
- **Instance**: t3.small in us-east-1, Ubuntu 24.04 LTS, 30GB gp3 EBS
- **Domain**: `ai.example.com` (DNS managed via existing registrar/DNS provider)
- **Budget**: $15-35/month target
- **Reference**: See `quickstart.md` for step-by-step guide, `spec.md` success criteria

## Subtasks

### T033: Provision EC2 Instance

**Purpose**: Create the production EC2 instance with appropriate specs and security configuration.

**Steps**:
1. Launch EC2 instance via AWS Console or CLI:
   - **AMI**: Ubuntu 24.04 LTS (latest official)
   - **Instance type**: t3.small (2 vCPU, 2GB RAM) — upgrade to t3.medium if needed
   - **Region**: us-east-1 (or team-preferred region)
   - **Storage**: 30GB gp3 EBS volume
   - **Key pair**: Create or use existing SSH key pair for deployment

2. Configure Security Group:
   - Inbound: 22 (SSH), 80 (HTTP), 443 (HTTPS)
   - Outbound: All traffic (needed for Docker Hub, GHCR, external APIs)

3. Allocate and associate an Elastic IP (prevents IP change on stop/start)

4. SSH in and run `setup-ec2.sh`:
   ```bash
   scp -r deploy/ ubuntu@<EC2_IP>:/opt/joyus-ai/
   ssh ubuntu@<EC2_IP>
   sudo /opt/joyus-ai/deploy/scripts/setup-ec2.sh
   ```

5. Create `.env` file on EC2 from `.env.example`:
   ```bash
   cp /opt/joyus-ai/deploy/.env.example /opt/joyus-ai/deploy/.env
   # Edit with actual values
   nano /opt/joyus-ai/deploy/.env
   ```

**Validation**:
- [ ] EC2 instance running with correct specs (t3.small, Ubuntu 24.04, 30GB)
- [ ] Elastic IP assigned and stable
- [ ] SSH access working with key pair
- [ ] `setup-ec2.sh` completed without errors
- [ ] Docker, nginx, certbot, fail2ban all installed
- [ ] `.env` file populated with real credentials

**Edge Cases**:
- t3.small may run out of memory under load — monitor and upgrade to t3.medium if needed
- EBS volume can be expanded later without downtime
- Elastic IP costs $0 while associated with running instance, ~$4/mo if instance stopped

---

### T034: Configure DNS: ai.example.com → EC2 IP

**Purpose**: Point the domain to the EC2 instance so TLS and routing work.

**Steps**:
1. Add DNS A record:
   - **Name**: `ai` (subdomain of example.com)
   - **Type**: A
   - **Value**: Elastic IP from T033
   - **TTL**: 300 (5 minutes for quick propagation during setup)

2. Verify DNS propagation:
   ```bash
   dig ai.example.com +short
   # Should return the Elastic IP
   ```

3. Once DNS resolves, run certbot on EC2:
   ```bash
   sudo certbot --nginx -d ai.example.com --non-interactive --agree-tos -m admin@example.com
   ```

4. Verify HTTPS works:
   ```bash
   curl -I https://ai.example.com
   # Should return 200 or 301 (nginx is running but containers may not be up yet)
   ```

**Validation**:
- [ ] `dig ai.example.com` returns correct Elastic IP
- [ ] Certbot obtains valid TLS certificate
- [ ] `https://ai.example.com` is reachable (HTTPS works)
- [ ] Certificate auto-renewal timer active

**Edge Cases**:
- DNS propagation can take up to 48 hours (usually <30 minutes)
- Certbot will fail if DNS hasn't propagated yet — retry after waiting
- Let's Encrypt rate limit: 5 certs per domain per week in production

---

### T035: Set GitHub Actions Secrets

**Purpose**: Configure all secrets needed for the CI/CD pipeline to deploy automatically.

**Steps**:
1. Set the following GitHub Actions secrets on the `joyus-ai/joyus-ai` repository:

   | Secret | Value | Notes |
   |--------|-------|-------|
   | `EC2_HOST` | Elastic IP address | From T033 |
   | `EC2_SSH_KEY` | Private key (PEM format) | Key pair from T033 |
   | `EC2_USER` | `ubuntu` | Default Ubuntu AMI user |
   | `SLACK_WEBHOOK_URL` | Slack incoming webhook URL | For deploy notifications |

2. Set via GitHub CLI:
   ```bash
   gh secret set EC2_HOST --body "<elastic-ip>"
   gh secret set EC2_SSH_KEY < ~/.ssh/joyus-ai-deploy.pem
   gh secret set EC2_USER --body "ubuntu"
   gh secret set SLACK_WEBHOOK_URL --body "<webhook-url>"
   ```

3. Verify secrets are set:
   ```bash
   gh secret list
   ```

4. Note: `GITHUB_TOKEN` is automatically available in Actions (no need to set it)
5. Note: Application secrets (POSTGRES_PASSWORD, ENCRYPTION_KEY, etc.) are in the EC2 `.env` file, NOT in GitHub Actions secrets

**Validation**:
- [ ] All 4 secrets set in GitHub repository settings
- [ ] `gh secret list` shows EC2_HOST, EC2_SSH_KEY, EC2_USER, SLACK_WEBHOOK_URL
- [ ] No application secrets (API keys, passwords) in GitHub Actions

**Edge Cases**:
- SSH key must be in PEM format (not OpenSSH format) for `appleboy/ssh-action`
- `gh auth refresh -h github.com -s workflow` may be needed for pushing workflow files

---

### T036: First Production Deployment and Smoke Test

**Purpose**: Trigger the first automated deployment and verify everything works end-to-end.

**Steps**:
1. Push the deploy workflow and Docker configs to main:
   ```bash
   git add .github/workflows/deploy-mcp.yml deploy/ web-chat/
   git commit -m "Add deployment infrastructure"
   git push origin main
   ```

2. Monitor GitHub Actions:
   - Check build job (images building)
   - Check push to GHCR (images tagged)
   - Check deploy job (SSH to EC2, compose up)

3. Run smoke test from local machine:
   ```bash
   # Health check
   curl https://ai.example.com/health

   # MCP endpoint (with bearer token)
   curl -H "Authorization: Bearer <MCP_BEARER_TOKEN>" https://ai.example.com/mcp

   # Web chat
   curl https://ai.example.com/chat

   # Playwright
   curl https://ai.example.com/playwright
   ```

4. Run the full health check script:
   ```bash
   ./deploy/scripts/health-check.sh https://ai.example.com
   ```

5. Verify Slack notification received for deploy success

**Validation**:
- [ ] GitHub Actions workflow completes successfully
- [ ] Both Docker images in GHCR (check `gh api orgs/<org>/packages`)
- [ ] All health endpoints return 200
- [ ] MCP endpoint responds with bearer token auth
- [ ] Web chat page loads
- [ ] Slack deploy notification received
- [ ] Deployment completed within 10 minutes

**Edge Cases**:
- First build will be slowest (no cache) — expect 8-12 minutes
- If deploy fails, check GitHub Actions logs for SSH connection issues
- If health check fails post-deploy, check container logs: `docker compose logs`

---

### T037: Verify Team Member Claude Desktop Connections

**Purpose**: Confirm at least 2 team members can connect via Claude Desktop.

**Steps**:
1. Share the Claude Desktop config with team members:
   ```json
   {
     "mcpServers": {
       "joyus-ai": {
         "url": "https://ai.example.com/mcp",
         "headers": {
           "Authorization": "Bearer <MCP_BEARER_TOKEN>"
         }
       }
     }
   }
   ```

2. Each team member should:
   - Add the config to their Claude Desktop
   - Restart Claude Desktop
   - Verify MCP indicator shows connected
   - Try a tool call: "Search Jira for recent bugs"
   - Try another: "List our GitHub repositories"

3. Collect confirmation from at least 2 team members

4. Document any issues encountered and their resolutions

**Validation**:
- [ ] Team member #1 connected and executed tool calls successfully
- [ ] Team member #2 connected and executed tool calls successfully
- [ ] Both macOS and Windows tested (if team has both)
- [ ] Any issues documented with resolutions

**Edge Cases**:
- Windows Claude Desktop config path differs from macOS
- Corporate firewalls may block WebSocket connections — verify port 443 is sufficient
- Bearer token distribution should be secure (not via Slack/email plaintext — use a secure channel)

---

### T038: Verify Web Chat from Mobile Device

**Purpose**: Confirm the web chat works from a real mobile phone browser.

**Steps**:
1. Open `https://ai.example.com/chat` on iPhone Safari
2. Enter authentication token
3. Send a test message: "Search Jira for tickets assigned to me"
4. Verify:
   - Response streams in real-time
   - Tool call results display correctly
   - Keyboard doesn't obscure input
   - Page is readable without zooming
   - Send button accessible above keyboard

5. Repeat on Chrome Android if available

6. Test from a different network (mobile data, not office WiFi) to verify external access

**Validation**:
- [ ] Chat loads on iPhone Safari
- [ ] Authentication works
- [ ] Message sent and response received with tool results
- [ ] UI is usable (no layout issues, readable text, accessible buttons)
- [ ] Works on mobile data (not just office network)

**Edge Cases**:
- iOS Safari may handle streaming differently than desktop browsers
- Mobile data may have higher latency — ensure timeouts are generous
- Auto-zoom on text input (iOS) — prevented by 16px font-size

## Definition of Done

- [ ] EC2 instance running at Elastic IP
- [ ] `ai.example.com` resolves and serves HTTPS
- [ ] All health checks green: `curl https://ai.example.com/health` returns `{"status":"ok"}`
- [ ] CI/CD works: push to main triggers automated deploy
- [ ] 2+ team members connected via Claude Desktop and executed tool calls
- [ ] Web chat works from mobile phone browser
- [ ] Slack notifications configured for deploys and downtime
- [ ] Monthly cost confirmed under $35/month

## Risks

- **DNS propagation delay**: Usually <30 minutes, worst case 48 hours. Have a backup plan (direct IP access) during propagation.
- **t3.small memory**: 2GB RAM may be insufficient if all containers peak simultaneously. Monitor and be ready to upgrade to t3.medium ($15→$30/month).
- **OAuth token migration**: Tokens from local dev environment may need re-authorization if redirect URIs or scopes differ in production.
- **Certbot rate limits**: 5 certificates per domain per week. Don't delete and re-request repeatedly during testing.
- **Team onboarding**: First-time MCP config can be confusing. The `claude-desktop-config.md` doc should make this self-service.
