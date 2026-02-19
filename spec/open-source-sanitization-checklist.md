# Open Source Sanitization Checklist

> Items that must be addressed before the `joyus-ai` repository is made public.
> Generated from security review on February 18, 2026.
> Updated: February 19, 2026 — repository separation and sanitization pass completed.

---

## HIGH PRIORITY (Must fix before release)

### 1. Personal User Paths ✅

Remove all `/Users/AlexUA/` references that expose developer machine layout.

| File | Status |
|------|--------|
| `joyus-ai-requirements-brief.md` | **Moved** to `_private/joyus-ai-internal/` |
| `.kittify/metadata.yaml` (line ~68) | **Fixed** — path genericized |

### 2. Private Notion Links ✅

| File | Status |
|------|--------|
| `joyus-ai-plan.md` | **Moved** to `_private/joyus-ai-internal/` |
| `research/jawn-ai-research.md` | **Moved** to `_private/joyus-ai-internal/` |

### 3. NCLC Client References ✅

| File | Status |
|------|--------|
| `joyus-ai-requirements-brief.md` | **Moved** to `_private/joyus-ai-internal/` |
| `joyus-ai-plan.md` | **Moved** to `_private/joyus-ai-internal/` |
| `spec/profile-engine-spec.md` | **Fixed** — all NCLC refs genericized to "client PoC" |
| `spec/constitution.md` | **Fixed** — genericized to "client PoC" |
| `spec/plan.md` | **Fixed** — all NCLC refs genericized |
| `kitty-specs/*/spec.md` | **Fixed** — "nclclib" → "prior project", "NCLC" → "client PoC" |
| `joyus-ai-state/tests/` | **Fixed** — test fixture genericized |

### 4. Internal Infrastructure References ✅

| File | Status |
|------|--------|
| `research/tool-inventory-briefing.md` | **Moved** to `_private/joyus-ai-internal/` |

---

## MEDIUM PRIORITY (Fix for professional release)

### 5. Internal Email Addresses ✅

All `@zivtech.com` emails replaced with `@example.com` placeholders.

| File | Status |
|------|--------|
| `zivtech-skills-marketplace-architecture.html` | **Moved** to `_private/joyus-ai-internal/` |
| `joyus-ai-mcp-server/docs/PLATFORM_ARCHITECTURE.md` | **Fixed** |
| `joyus-ai-mcp-server/docs/IMPLEMENTATION_PLAN.md` | **Fixed** |
| `joyus-ai-mcp-server/docs/SKILLS_MARKETPLACE_ARCHITECTURE.md` | **Fixed** |
| `joyus-ai-mcp-server/src/scheduler/routes.ts` | **Fixed** |
| `joyus-ai-mcp-server/src/auth/routes.ts` | **Fixed** |

### 6. Internal Domain References ✅

All `ai.zivtech.com`, `mcp.zivtech.com`, `demos.zivtech.com` replaced with `*.example.com`.

| File | Status |
|------|--------|
| `jawn-ai-platform-overview.jsx` | **Moved** to `_private/joyus-ai-internal/` |
| `joyus-ai-plan.md` | **Moved** to `_private/joyus-ai-internal/` |
| `hosting-comparison.md` | **Moved** to `_private/joyus-ai-internal/` |
| `deploy/.env.example` | **Fixed** |
| `deploy/claude-desktop-config.md` | **Fixed** |
| `kitty-specs/001-*/` (all files) | **Fixed** |
| `joyus-ai-mcp-server/` (docs, code) | **Fixed** |

### 7. Docker Compose Dev Defaults ✅

| File | Status |
|------|--------|
| `deploy/docker-compose.yml` | **Fixed** — warning comment added |

---

## LOW PRIORITY (Nice to have)

### 8. Spec Kitty Metadata ✅

| File | Status |
|------|--------|
| `.kittify/metadata.yaml` (line ~68) | **Fixed** — path genericized |

---

## Repository Separation (Added Feb 19)

Files moved to `_private/` staging directories (gitignored):

### `_private/joyus-ai-ops/` (production infrastructure)
- `deploy/docker-compose.prod.yml`
- `deploy/nginx/` (full directory)
- `deploy/scripts/deploy.sh`, `setup-ec2.sh`, `monitor.sh`, `slack-alert.sh`

### `_private/joyus-ai-internal/` (business docs, research, outreach)
- Planning: `joyus-ai-plan.md`, `joyus-ai-requirements-brief.md`, `project-status-feb10.md`, `ROADMAP-internal.md`
- Research: all files from `research/`, `ai-platform-naming-research.md`, `hosting-comparison.md`
- Outreach: `spec/outreach/` (briefs, PDFs, logo)
- Specs: `internal-ai-portal-spec.md`, `specification.md`, `implementation-summary.md`, `toolkit-diagnosis.md`, `toolkit-refactoring-design.md`
- Legacy: `jawn-ai-platform-overview.jsx`, `zivtech-skills-marketplace-architecture.html`

### Deleted (no repo)
- `zivtech-claude-skills-repo` (symlink to local dev path)
- `.conductor/` (empty directory)
- `.entire/` (session logs)

---

## Remaining for Professional Release

### 9. "Zivtech AI" Product Branding

Many files still use "Zivtech AI" as the product name in titles, page headings, and ASCII art. These should be renamed to "Joyus AI" in a follow-up pass:
- `joyus-ai-mcp-server/src/scheduler/routes.ts` — HTML page titles
- `joyus-ai-mcp-server/docs/*.md` — document titles
- `joyus-ai-mcp-server/ARCHITECTURE.md` — title
- `kitty-specs/003-platform-architecture-overview/` — references

### 10. License and Community Files

Before making public:
- [ ] Choose and apply license (see Constitution §2.8 — AGPL or BSL recommended)
- [ ] Add `LICENSE` file
- [ ] Add `CONTRIBUTING.md`
- [ ] Add `CODE_OF_CONDUCT.md`
- [ ] Run `gitleaks` / `trufflehog` final scan
- [ ] Verify repo builds without private dependencies

---

## Already Clean

These areas passed review:
- `.gitignore` properly configured (staging dirs, secrets, AI IDE dirs excluded)
- `.env.example` uses proper placeholders
- No hardcoded API keys or tokens anywhere in the codebase
- No secrets found in git commit history
- GitHub references are to public repos only

---

*Created: February 18, 2026*
*Updated: February 19, 2026 — repository separation and bulk sanitization completed*
*Status: Core sanitization complete. Branding rename and license selection remaining.*
