# Jawn AI Platform — Hosting Comparison

**Date:** February 11, 2026
**Status:** ✅ Decisions made

---

## Decisions

| Workload | Decision | Cost |
|----------|----------|------|
| **MCP Server + Activepieces** | Docker Compose on AWS EC2 (t3.medium) | ~$33/mo |
| **Static PoCs** | GitHub Pages + StatiCrypt | Free |
| **Drupal PoCs** | Pantheon Multidev / Tugboat / Probo.ci (separate system) | Already covered |

**Rationale:** Three separate, purpose-fit systems. No vendor lock-in. Drupal PoCs are a solved problem with existing tools — no need to bundle them with the platform hosting. EC2 instance sized at t3.medium to accommodate Activepieces (Phase 2.5) alongside the MCP server.

---

## The Three Workloads

| Workload | Stack | Host | Notes |
|----------|-------|------|-------|
| **MCP Server** | Node.js + TypeScript + PostgreSQL | AWS EC2 + Docker Compose | The platform itself — auth, tool executors, scheduled tasks |
| **Activepieces** | TypeScript + PostgreSQL + Redis | AWS EC2 + Docker Compose (same instance) | Workflow automation — visual builder, 200+ integrations, webhook triggers (Phase 2.5) |
| **Static PoCs** | HTML, PDFs, built React apps | GitHub Pages + StatiCrypt | Password-protected, directory-based, git-managed |
| **Drupal PoCs** | PHP + MySQL/PostgreSQL + webserver | Multidev / Tugboat / Probo.ci | Separate system, existing tools |

---

## Option A: Platform.sh / Upsun

Zivtech already hosts Drupal here. Supports Node.js, Python, and static sites natively.

| Factor | Assessment |
|--------|------------|
| **MCP Server** | ✅ Node.js + PostgreSQL supported as first-class runtimes |
| **Static PoCs** | ✅ Supported; can serve from same project or separate apps |
| **Drupal PoCs** | ✅ Best-in-class Drupal hosting; this is their core strength |
| **Password protection** | ⚠️ No built-in; use StatiCrypt for static, Drupal auth for Drupal, HTTP basic auth via `.platform/routes.yaml` |
| **Multi-tenant path** | ✅ Environment-per-branch, multiple apps per project |
| **Git workflow** | ✅ Git-native — push to deploy, environment per branch |
| **Custom domains** | ✅ Full support with automatic TLS |
| **Team familiarity** | ✅ Zivtech already uses it |
| **Cost** | ⚠️ $19/mo minimum per project (Upsun); can add up with many PoCs. Development environments included but resource-metered |
| **Complexity** | Low-Medium — familiar platform, `.platform.app.yaml` config |
| **Biggest win** | Single provider for all three workloads. Team already knows it. Git-native. |
| **Biggest risk** | Cost at scale if running many simultaneous Drupal PoCs. Node.js is supported but not their specialty — less community support for debugging. |

**Architecture sketch:**
- Project 1: MCP server (Node.js app + PostgreSQL service)
- Project 2: Static PoC host (static app, StatiCrypt-encrypted, directory-based)
- Project N: Individual Drupal PoC instances

---

## Option B: AWS (ECS/Fargate + S3/CloudFront + RDS)

Maximum flexibility. Can host anything. Most operational overhead.

| Factor | Assessment |
|--------|------------|
| **MCP Server** | ✅ ECS/Fargate for Node.js, RDS for PostgreSQL |
| **Static PoCs** | ✅ S3 + CloudFront; cheapest static hosting at scale |
| **Drupal PoCs** | ✅ ECS/Fargate + RDS + EFS; full control |
| **Password protection** | ⚠️ StatiCrypt for static; CloudFront signed URLs or Lambda@Edge for more; Drupal auth for Drupal |
| **Multi-tenant path** | ✅ Best path — ECS services per tenant, shared or isolated databases, IAM boundaries |
| **Git workflow** | ⚠️ Not built-in; needs CodePipeline/CodeDeploy or GitHub Actions deploying to AWS |
| **Custom domains** | ✅ Full support via Route 53 + CloudFront |
| **Team familiarity** | ✅ Zivtech has AWS experience |
| **Cost** | Fargate: ~$30-50/mo per small service. RDS: ~$15-30/mo (db.t4g.micro). S3/CloudFront: pennies for static. Total for MCP + a few Drupal PoCs: ~$100-200/mo |
| **Complexity** | High — many moving parts (VPC, ECS, RDS, S3, CloudFront, IAM, secrets, CI/CD) |
| **Biggest win** | Most scalable. Best multi-tenant isolation. Full control over everything. |
| **Biggest risk** | Operational complexity. Easy to over-engineer. Significant setup time before first deploy. |

**Architecture sketch:**
- ECS cluster with Fargate services (MCP server, Drupal instances)
- RDS PostgreSQL (shared or per-tenant)
- S3 + CloudFront for static PoCs
- GitHub Actions → ECR → ECS deploy pipeline
- Secrets Manager for credentials

---

## Option C: Railway or Render (Modern PaaS)

Heroku-like simplicity with modern pricing. Push to deploy.

| Factor | Assessment |
|--------|------------|
| **MCP Server** | ✅ Excellent — Node.js + PostgreSQL is their sweet spot |
| **Static PoCs** | ✅ Static site hosting included |
| **Drupal PoCs** | ⚠️ Possible via Docker, but not a natural fit. No persistent disk on Railway (need S3/external for files). Render has persistent disks. |
| **Password protection** | ⚠️ No built-in; StatiCrypt for static |
| **Multi-tenant path** | ⚠️ Can spin up services per tenant but less mature isolation than AWS |
| **Git workflow** | ✅ Push to deploy, PR previews |
| **Custom domains** | ✅ Supported |
| **Team familiarity** | ❌ Likely new to the team |
| **Cost** | Railway: $5/mo + usage. Render: free tier for static, $7/mo per web service. PostgreSQL: $7/mo. Competitive for small scale. |
| **Complexity** | Low — closest to "just push and it works" |
| **Biggest win** | Fastest time to first deploy for the MCP server. Great DX. |
| **Biggest risk** | Drupal hosting is awkward. Another provider to learn. Less mature for production workloads. |

---

## Option D: Coolify on Linode/VPS (Self-hosted PaaS)

Open-source, self-hosted. Docker-native. Full control, lowest cost at scale.

| Factor | Assessment |
|--------|------------|
| **MCP Server** | ✅ Docker Compose deployment, full control |
| **Static PoCs** | ✅ Nginx containers or static site builds |
| **Drupal PoCs** | ✅ Docker-based Drupal is well-established |
| **Password protection** | ⚠️ Traefik middleware can add HTTP basic auth per-route; StatiCrypt for static |
| **Multi-tenant path** | ⚠️ Possible but manual — Docker networks for isolation, no built-in tenant management |
| **Git workflow** | ✅ Git integration available, Docker Compose native |
| **Custom domains** | ✅ Automatic Let's Encrypt via Traefik |
| **Team familiarity** | ⚠️ Depends on Docker/DevOps comfort |
| **Cost** | Linode: $12-24/mo for a capable VPS. Coolify: free. Total: lowest option by far. |
| **Complexity** | Medium-High — self-managed infrastructure. Backups, updates, monitoring are on you. |
| **Biggest win** | Cheapest. Most control. Can run literally anything. |
| **Biggest risk** | Operational burden. Coolify still maturing (some users reporting stability issues in 2025-26). Single point of failure without HA setup. |

---

## Option E: Hybrid — Cloudflare Pages (static) + Platform.sh (dynamic)

Use the best tool for each job. Two providers, clean separation.

| Factor | Assessment |
|--------|------------|
| **MCP Server** | ✅ Platform.sh — Node.js + PostgreSQL |
| **Static PoCs** | ✅ Cloudflare Pages — free, unlimited bandwidth, fastest CDN |
| **Drupal PoCs** | ✅ Platform.sh — native Drupal |
| **Password protection** | StatiCrypt on Cloudflare Pages; Drupal auth on Platform.sh |
| **Multi-tenant path** | ✅ Platform.sh environments for dynamic; Cloudflare for static |
| **Git workflow** | ✅ Both are git-native |
| **Custom domains** | ✅ Both support it |
| **Cost** | Cloudflare Pages: free. Platform.sh: existing account pricing. |
| **Complexity** | Medium — two providers but clean separation of concerns |
| **Biggest win** | Static PoCs cost nothing and deploy instantly. Dynamic workloads on a familiar platform. |
| **Biggest risk** | Two systems to manage. Static/dynamic boundary can blur (what if a "static" PoC needs an API?). |

---

## Final Decision & Architecture

### Ruled Out
- **Platform.sh / Upsun** — Too expensive, cumbersome for this use case
- **Pantheon** — Not for hosting files/static content (Multidev still fine for Drupal PoC previews)
- **Railway / Render** — Unnecessary cost premium over a VPS for a team comfortable with Docker

### Chosen Architecture

**1. MCP Server + Activepieces → Docker Compose on AWS EC2**
- Node.js + PostgreSQL in containers (MCP server)
- Activepieces + separate PostgreSQL + Redis in containers (Phase 2.5)
- Docker Compose for orchestration
- GitHub Actions for CI/CD (build → push image → deploy)
- AWS: t3.medium ~$33/mo (4GB RAM — accommodates both services with headroom)
- Scales to multi-tenant by adding services or upgrading instance
- AWS MCP ecosystem (45+ official servers from awslabs) enables Claude to help manage infrastructure
- Optional: Coolify as management UI (evaluate after initial deploy)

**Resource breakdown (Phase 2.5):**

| Service | RAM |
|---------|-----|
| MCP Server (Node.js) | ~400MB |
| PostgreSQL (jawn-ai) | ~256MB |
| Activepieces | ~1.5GB |
| PostgreSQL (Activepieces) | ~256MB |
| Redis (Activepieces) | ~128MB |
| OS overhead | ~500MB |
| **Total** | **~3.0GB** (1GB headroom on t3.medium) |

**2. Static PoCs → GitHub Pages + StatiCrypt**
- Free, zero infrastructure
- StatiCrypt encrypts HTML with AES-256 on push (GitHub Actions)
- Per-project passwords stored in GitHub Secrets
- Directory-based: `zivtech.github.io/poc-name/`
- Custom domain (e.g., `demos.zivtech.com`) when ready
- Path to Drupal portal: directory structure carries forward

**3. Drupal PoCs → Existing tools (separate system)**
- Pantheon Multidev for Pantheon-hosted projects
- Tugboat for PR-based preview environments
- Probo.ci for CI-integrated previews
- No new infrastructure needed

### Quick-Start Path

1. Provision AWS EC2 (t3.medium), install Docker + Compose
2. Deploy MCP server (Node.js + PostgreSQL containers)
3. Set up GitHub Actions pipeline for the MCP server
4. Configure GitHub Pages on jawn-ai or a dedicated PoC repo with StatiCrypt
5. First static PoC deployed and password-protected
6. Add Activepieces to Docker Compose (Phase 2.5) — app + PostgreSQL + Redis
7. Build proof-of-concept workflows, validate resource usage
8. Evaluate after 1 month; consider Coolify or scaling if needed
