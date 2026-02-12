---
work_package_id: "WP01"
title: "Docker Compose & Container Images"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005"]
history:
  - date: "2026-02-12"
    event: "Created"
    agent: "spec-kitty.tasks"
---

# WP01: Docker Compose & Container Images

**Implement with**: `spec-kitty implement WP01`

## Objective

Create all Docker configuration files for the 3-container architecture: Platform (jawn-ai MCP server + skill runtime), Playwright (browser automation), and PostgreSQL (database). This is the foundation everything else builds on.

## Context

- **Architecture**: 3 consolidated containers behind nginx (configured in WP02)
- **Platform container**: Node.js 20 + Python 3.12 + system packages + squirrel binary
- **Playwright container**: Microsoft Playwright base image + Backstop.js
- **PostgreSQL**: postgres:16-alpine with persistent volume
- **Reference**: See `plan.md` Container Architecture section and `data-model.md` Service Topology

## Subtasks

### T001: Create Docker Compose Base Configuration

**Purpose**: Define all 3 services, networking, and volumes in a single compose file.

**Steps**:
1. Create `deploy/docker-compose.yml` with these services:
   - `platform`: builds from `Dockerfile.platform`, exposes ports 3000 (MCP) and 3001 (web chat) on internal network
   - `playwright`: builds from `Dockerfile.playwright`, exposes port 3002 on internal network
   - `postgres`: uses `postgres:16-alpine`, port 5432 internal only
2. Define networks:
   - `jawn-net`: bridge network for inter-container communication
3. Define volumes:
   - `postgres-data`: named volume for PostgreSQL persistence
   - `memory-data`: named volume for Memory MCP knowledge graph
4. Set environment variables via `env_file: .env`
5. Add `depends_on` — platform and playwright depend on postgres

**Files**:
- `deploy/docker-compose.yml` (new, ~60 lines)

**Validation**:
- [ ] `docker compose config` validates without errors
- [ ] All 3 services defined with correct ports
- [ ] Named volumes defined for persistence
- [ ] Internal network created

---

### T002: Write Platform Container Dockerfile

**Purpose**: Multi-stage build that layers Node.js, Python, system packages, and CLI tools into a single image for the jawn-ai MCP server and skill runtime.

**Steps**:
1. Create `deploy/Dockerfile.platform` with multi-stage build:
   - **Stage 1 — Node.js base**: `FROM node:20-bookworm`
   - **Stage 2 — System packages**:
     ```dockerfile
     RUN apt-get update && apt-get install -y \
       python3 python3-pip python3-venv \
       git php-cli php-xml php-mbstring php-curl \
       && rm -rf /var/lib/apt/lists/*
     ```
   - **Stage 3 — Python packages** (use venv to avoid PEP 668):
     ```dockerfile
     RUN python3 -m venv /opt/venv
     ENV PATH="/opt/venv/bin:$PATH"
     RUN pip install python-pptx python-docx openpyxl lxml pypdf \
       pillow imageio numpy requests PyYAML packaging
     ```
   - **Stage 4 — Composer + Drush**:
     ```dockerfile
     RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
     RUN composer global require drush/drush
     ```
   - **Stage 5 — Squirrel CLI**:
     ```dockerfile
     RUN curl -fsSL https://squirrelscan.com/install | bash
     ```
   - **Stage 6 — Application code**:
     ```dockerfile
     WORKDIR /app
     COPY jawn-ai-mcp-server/package*.json ./
     RUN npm ci --production
     COPY jawn-ai-mcp-server/ ./
     ```
   - **Stage 7 — Node packages for skills**:
     ```dockerfile
     RUN npm install -g html2pptx
     ```
2. Set `EXPOSE 3000 3001`
3. Set `CMD ["node", "src/index.js"]`

**Files**:
- `deploy/Dockerfile.platform` (new, ~80 lines)

**Validation**:
- [ ] `docker build -f deploy/Dockerfile.platform .` completes without errors
- [ ] `docker run --rm platform python3 -c "import pptx, docx, openpyxl"` succeeds
- [ ] `docker run --rm platform squirrel --version` succeeds
- [ ] `docker run --rm platform composer --version` succeeds
- [ ] `docker run --rm platform drush --version` succeeds
- [ ] Image size under 2.5GB

**Edge Cases**:
- Squirrel install script may change — pin version or download binary directly
- Composer global bin path must be in PATH
- Python venv required on Debian bookworm (PEP 668 externally-managed)

---

### T003: Write Playwright Container Dockerfile [P]

**Purpose**: Container with Playwright browsers and Backstop.js for visual regression testing.

**Steps**:
1. Create `deploy/Dockerfile.playwright`:
   ```dockerfile
   FROM mcr.microsoft.com/playwright:v1.50.0-noble
   WORKDIR /app
   RUN npm init -y && npm install @anthropic-ai/mcp playwright backstopjs
   EXPOSE 3002
   CMD ["node", "server.js"]
   ```
2. Create a minimal MCP server wrapper (`deploy/playwright-server/server.js`) that exposes Playwright and Backstop.js tools via MCP protocol
3. Ensure headless mode is default (no display required)

**Files**:
- `deploy/Dockerfile.playwright` (new, ~20 lines)
- `deploy/playwright-server/server.js` (new, ~100 lines)

**Validation**:
- [ ] Container starts and listens on port 3002
- [ ] Can navigate to a URL and return screenshot
- [ ] Backstop.js reference/test comparison works

---

### T004: Configure PostgreSQL Service [P]

**Purpose**: PostgreSQL with persistent storage that survives container restarts and redeployments.

**Steps**:
1. In `docker-compose.yml`, configure postgres service:
   ```yaml
   postgres:
     image: postgres:16-alpine
     environment:
       POSTGRES_DB: jawn_ai
       POSTGRES_USER: jawn
       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
     volumes:
       - postgres-data:/var/lib/postgresql/data
     networks:
       - jawn-net
     healthcheck:
       test: ["CMD-SHELL", "pg_isready -U jawn -d jawn_ai"]
       interval: 10s
       timeout: 5s
       retries: 5
   ```
2. Ensure the existing Drizzle ORM migrations from `jawn-ai-mcp-server/` run on startup (or via entrypoint script)

**Files**:
- Updates to `deploy/docker-compose.yml` (postgres service section)

**Validation**:
- [ ] PostgreSQL starts and accepts connections
- [ ] Data persists after `docker compose down && docker compose up`
- [ ] Drizzle migrations run successfully
- [ ] Healthcheck reports healthy

---

### T005: Create Environment Variable Template

**Purpose**: Document all required environment variables so deployment is reproducible.

**Steps**:
1. Create `deploy/.env.example`:
   ```env
   # PostgreSQL
   POSTGRES_PASSWORD=changeme
   DATABASE_URL=postgresql://jawn:changeme@postgres:5432/jawn_ai

   # Encryption
   ENCRYPTION_KEY=generate-a-32-byte-hex-key

   # MCP Authentication
   MCP_BEARER_TOKEN=generate-a-secure-token

   # Claude API (for web chat)
   CLAUDE_API_KEY=sk-ant-...

   # OAuth (migrated from local dev)
   JIRA_CLIENT_ID=
   JIRA_CLIENT_SECRET=
   SLACK_BOT_TOKEN=xoxb-...
   GITHUB_TOKEN=ghp_...
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=

   # Domain
   DOMAIN=ai.zivtech.com
   LETSENCRYPT_EMAIL=admin@zivtech.com
   ```
2. Add `deploy/.env` to `.gitignore` (the actual env file must never be committed)

**Files**:
- `deploy/.env.example` (new, ~25 lines)
- Update `.gitignore` to include `deploy/.env`

**Validation**:
- [ ] Every variable referenced in docker-compose.yml is documented
- [ ] `.env` is gitignored
- [ ] Comments explain what each variable is for

## Definition of Done

- [ ] `docker compose build` succeeds for all images
- [ ] `docker compose up -d` starts all 3 containers
- [ ] Containers can communicate on internal network (platform can reach postgres and playwright)
- [ ] PostgreSQL data persists across restarts
- [ ] All skill runtime dependencies installed and accessible in Platform container
- [ ] `.env.example` documents every required variable

## Risks

- **Image size**: Platform container may exceed 2GB. Acceptable for now; optimize later with multi-stage builds that copy only artifacts.
- **Build time**: Full build may take 5-10 minutes. Use Docker layer caching.
- **Playwright version**: Pin to specific version to avoid breaking changes in browser binaries.
