---
work_package_id: WP02
title: EC2 Provisioning & Nginx
lane: "done"
dependencies: []
base_branch: 001-mcp-server-aws-deployment-WP01
base_commit: 14d387e020a5b4466093c805bc4abd3c927070c0
created_at: '2026-02-19T01:16:19.375991+00:00'
subtasks: [T006, T007, T008, T009, T010]
shell_pid: "13503"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP02: EC2 Provisioning & Nginx

**Implement with**: `spec-kitty implement WP02 --base WP01`

## Objective

Create the EC2 provisioning script, nginx reverse proxy configuration, TLS setup, firewall rules, and production Docker Compose overrides. After this work package, a fresh Ubuntu 24.04 instance can be fully provisioned from scratch and route HTTPS traffic to all backend containers.

## Context

- **Dependencies**: WP01 (Docker Compose and containers must exist)
- **Architecture**: Nginx runs on the host (not in Docker) to manage TLS termination and path-based routing
- **Domain**: `ai.example.com` (with future rebrand URL)
- **Reference**: See `plan.md` Container Architecture, Security section, and `data-model.md` Network Topology

## Subtasks

### T006: Write EC2 Provisioning Script (`setup-ec2.sh`)

**Purpose**: Automate the one-time setup of a fresh Ubuntu 24.04 EC2 instance with all required system software.

**Steps**:
1. Create `deploy/scripts/setup-ec2.sh` with:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   ```
2. Install Docker Engine and Docker Compose v2:
   ```bash
   # Add Docker's official GPG key and repository
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
   apt-get update
   apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   ```
3. Install nginx and certbot:
   ```bash
   apt-get install -y nginx certbot python3-certbot-nginx
   ```
4. Install fail2ban for SSH brute-force protection:
   ```bash
   apt-get install -y fail2ban
   systemctl enable fail2ban
   ```
5. Configure swap (1GB — required for t3.small with 2GB RAM):
   ```bash
   fallocate -l 1G /swapfile
   chmod 600 /swapfile
   mkswap /swapfile
   swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
6. Add the deploy user to the `docker` group:
   ```bash
   usermod -aG docker ubuntu
   ```
7. Create application directory:
   ```bash
   mkdir -p /opt/joyus-ai
   chown ubuntu:ubuntu /opt/joyus-ai
   ```
8. Copy nginx config to `/etc/nginx/sites-available/joyus-ai`

**Files**:
- `deploy/scripts/setup-ec2.sh` (new, ~100 lines)

**Validation**:
- [ ] Script runs without errors on fresh Ubuntu 24.04
- [ ] Docker and Docker Compose installed and functional
- [ ] Nginx installed and running
- [ ] Fail2ban active
- [ ] 1GB swap enabled
- [ ] `/opt/joyus-ai` directory exists with correct ownership

**Edge Cases**:
- Script should be idempotent (safe to re-run)
- Check for existing swap before creating
- Handle apt lock contention (retry or fail gracefully)

---

### T007: Configure Nginx Reverse Proxy with Path-Based Routing

**Purpose**: Route external HTTPS traffic to the correct internal container service based on URL path.

**Steps**:
1. Create `deploy/nginx/nginx.conf`:
   ```nginx
   server {
       listen 80;
       server_name ai.example.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name ai.example.com;

       ssl_certificate /etc/letsencrypt/live/ai.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/ai.example.com/privkey.pem;

       # MCP endpoint (platform server)
       location /mcp {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 120s;
       }

       # API endpoints
       location /api/ {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # Web chat
       location /chat {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }

       # Playwright MCP
       location /playwright {
           proxy_pass http://127.0.0.1:3002;
           proxy_set_header Host $host;
           proxy_read_timeout 120s;
       }

       # Health check (aggregated)
       location /health {
           proxy_pass http://127.0.0.1:3000/health;
           proxy_set_header Host $host;
       }
   }
   ```
2. Enable WebSocket support for MCP and chat endpoints (Upgrade headers)
3. Set appropriate timeouts: 120s for Playwright operations, standard for others
4. Add security headers (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security)

**Files**:
- `deploy/nginx/nginx.conf` (new, ~80 lines)

**Validation**:
- [ ] `nginx -t` passes syntax validation
- [ ] HTTP→HTTPS redirect works
- [ ] `/mcp` routes to Platform :3000
- [ ] `/chat` routes to Platform :3001
- [ ] `/playwright` routes to Playwright :3002
- [ ] `/health` routes to aggregated health endpoint
- [ ] WebSocket connections work for MCP and chat

**Edge Cases**:
- Large request bodies (file uploads) need `client_max_body_size` directive
- Playwright requests may take >60s — ensure proxy timeout is sufficient
- WebSocket upgrade must be handled for MCP SSE/streaming

---

### T008: Set Up Let's Encrypt TLS via Certbot

**Purpose**: Automated TLS certificate provisioning and renewal for `ai.example.com`.

**Steps**:
1. Add certbot commands to `setup-ec2.sh` (runs after DNS is pointed):
   ```bash
   certbot --nginx -d ai.example.com --non-interactive --agree-tos -m admin@example.com
   ```
2. Verify auto-renewal timer is enabled:
   ```bash
   systemctl enable certbot.timer
   systemctl start certbot.timer
   ```
3. Add a post-renewal hook to reload nginx:
   ```bash
   # /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
   #!/bin/bash
   systemctl reload nginx
   ```
4. Add a note in the nginx config for initial setup (before cert exists, use self-signed or HTTP-only temporarily)

**Files**:
- Updates to `deploy/scripts/setup-ec2.sh` (certbot section)
- `deploy/nginx/pre-ssl.conf` (new, ~15 lines — HTTP-only config for initial certbot run)

**Validation**:
- [ ] `certbot certificates` shows valid certificate for ai.example.com
- [ ] Auto-renewal timer active (`systemctl status certbot.timer`)
- [ ] Certificate renews without manual intervention (test with `certbot renew --dry-run`)
- [ ] Nginx reloads after renewal

**Edge Cases**:
- Certbot requires DNS to already point to the EC2 IP — document this prerequisite
- Rate limits: Let's Encrypt has 5 certs/week/domain limit for production
- Initial deploy must work without TLS (HTTP-only nginx config), then switch after cert obtained

---

### T009: Configure Firewall Rules (UFW)

**Purpose**: Lock down the EC2 instance to only required ports.

**Steps**:
1. Add UFW configuration to `setup-ec2.sh`:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp    # SSH
   ufw allow 443/tcp   # HTTPS
   ufw allow 80/tcp    # HTTP (for certbot and redirect)
   ufw --force enable
   ```
2. Do NOT expose ports 3000, 3001, 3002, 5432 externally — these are internal only, accessed through nginx

**Files**:
- Updates to `deploy/scripts/setup-ec2.sh` (UFW section)

**Validation**:
- [ ] `ufw status` shows only ports 22, 80, 443 allowed
- [ ] Cannot reach port 3000, 3001, 3002, 5432 from external network
- [ ] SSH still accessible
- [ ] HTTPS traffic passes through

**Edge Cases**:
- Docker can bypass UFW rules by default — may need `DOCKER_OPTS="--iptables=false"` or configure `/etc/docker/daemon.json` with `"iptables": false`
- AWS Security Group provides additional layer — document both UFW and SG rules

---

### T010: Create Production Docker Compose Overrides

**Purpose**: Production-specific settings that override the base docker-compose.yml for resource limits, logging, and restart policies.

**Steps**:
1. Create `deploy/docker-compose.prod.yml`:
   ```yaml
   version: "3.8"
   services:
     platform:
       image: ghcr.io/zivtech/joyus-ai-platform:latest
       restart: unless-stopped
       deploy:
         resources:
           limits:
             memory: 1G
           reservations:
             memory: 512M
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"

     playwright:
       image: ghcr.io/zivtech/joyus-ai-playwright:latest
       restart: unless-stopped
       deploy:
         resources:
           limits:
             memory: 1G
           reservations:
             memory: 256M
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"

     postgres:
       restart: unless-stopped
       deploy:
         resources:
           limits:
             memory: 512M
           reservations:
             memory: 128M
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"
   ```
2. Override `build:` with `image:` for GHCR-sourced production images
3. Set memory limits appropriate for t3.small (2GB RAM total):
   - Platform: 1GB limit
   - Playwright: 1GB limit
   - PostgreSQL: 512MB limit
   - Note: total exceeds 2GB but relies on swap and not all containers peak simultaneously
4. Configure json-file log driver with rotation

**Files**:
- `deploy/docker-compose.prod.yml` (new, ~50 lines)

**Validation**:
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` validates
- [ ] Images reference GHCR URLs (not local builds)
- [ ] Restart policies set to `unless-stopped`
- [ ] Memory limits defined for all services
- [ ] Log rotation configured

## Definition of Done

- [ ] `setup-ec2.sh` can provision a fresh Ubuntu 24.04 instance end-to-end
- [ ] Nginx routes all paths correctly to backend services
- [ ] TLS certificate obtainable via certbot
- [ ] Only ports 22, 80, 443 exposed externally
- [ ] Production compose overrides validate with base compose file
- [ ] All scripts are executable and have proper shebang lines

## Risks

- **DNS dependency**: Certbot requires DNS pointed at EC2 before TLS can be provisioned. Initial setup must work without TLS.
- **Docker/UFW conflict**: Docker modifies iptables directly, potentially bypassing UFW. May need daemon.json configuration.
- **Memory pressure**: t3.small has 2GB RAM. With swap, should handle all 3 containers, but may need t3.medium if OOM occurs under load.
- **Nginx on host vs container**: Running nginx on host simplifies TLS management but means it's not in Docker Compose. Document this architecture decision.

## Activity Log

- 2026-02-19T01:54:43Z – unknown – shell_pid=13503 – lane=for_review – EC2 setup, nginx, TLS, firewall
- 2026-02-19T01:54:50Z – unknown – shell_pid=13503 – lane=done – Review passed: setup script, nginx, TLS, firewall all configured
