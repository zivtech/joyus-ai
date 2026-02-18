# Open Source Sanitization Checklist

> Items that must be addressed before the `joyus-ai` repository is made public.
> Generated from security review on February 18, 2026.

---

## HIGH PRIORITY (Must fix before release)

### 1. Personal User Paths

Remove all `/Users/AlexUA/` references that expose developer machine layout.

| File | What to Fix |
|------|-------------|
| `joyus-ai-requirements-brief.md` (lines ~17, 22) | Paths to `.claude/projects/` and `.jsonl` session files |
| `.kittify/metadata.yaml` (line ~68) | Path to `.claude/commands` |

**Fix:** Replace with generic paths like `~/.claude/projects/<project>/` or remove entirely.

### 2. Private Notion Links

Remove all links to private Notion databases — they expose internal workspace structure.

| File | Links |
|------|-------|
| `joyus-ai-plan.md` (lines ~6, 571, 572, 578) | 3 distinct Notion database URLs (Crazy Ideas, Technical Learning, Business & Partnership) |
| `research/jawn-ai-research.md` (lines ~641, 642) | Same Notion links repeated |

**Fix:** Remove links entirely or replace with `[Internal — Notion]` placeholder.

### 3. NCLC Client References

The NCLC (National Consumer Law Center) is an actual client project. References should be genericized.

| File | What to Fix |
|------|-------------|
| `joyus-ai-requirements-brief.md` | Multiple references to `nclclib`, `NCLC-test-files`, NCLC-specific pipeline |
| `joyus-ai-plan.md` (lines ~77-100) | Full section on NCLC PoC with specific accuracy numbers and author counts |
| `spec/profile-engine-spec.md` (lines ~40-95) | References to `legal_advocacy.yaml`, `fixtures/nclc/`, `test_nclc_accuracy.py` |
| `spec/constitution.md` (line ~30) | "methodology proven on NCLC: 94.6%→97.9% attribution accuracy" |

**Fix:** Either:
- Genericize: "methodology proven on a client PoC" with anonymized accuracy numbers
- Or move NCLC-specific documentation to a private repo and reference it abstractly

**Note:** The accuracy numbers and methodology description are fine to keep — just remove the client name and specific author counts.

### 4. Internal Infrastructure References

Remove references that expose Zivtech's internal server infrastructure.

| File | What to Fix |
|------|-------------|
| `research/tool-inventory-briefing.md` | `ops.zivtech.com` — reveals Docker Compose, Nginx, MariaDB, Jenkins, Open WebUI stack |

**Fix:** Remove or replace with `internal-ops.example.com`.

---

## MEDIUM PRIORITY (Fix for professional release)

### 5. Internal Email Addresses

Replace `@zivtech.com` emails with generic placeholders.

| File | Emails |
|------|--------|
| `zivtech-skills-marketplace-architecture.html` (line ~1044) | `dev@zivtech.com` |
| `joyus-ai-mcp-server/docs/PLATFORM_ARCHITECTURE.md` (lines ~373, 401-404) | `alex@zivtech.com`, `sarah@zivtech.com`, `mike@zivtech.com` |
| `joyus-ai-mcp-server/docs/IMPLEMENTATION_PLAN.md` (line ~169) | `alex@zivtech.com` |
| `joyus-ai-mcp-server/docs/SKILLS_MARKETPLACE_ARCHITECTURE.md` (line ~474) | `dev@zivtech.com` |
| `joyus-ai-mcp-server/src/scheduler/routes.ts` (lines ~220, 446) | `you@zivtech.com` |

**Fix:** Replace with `user@example.com`, `admin@example.com`, etc.

### 6. Internal Domain References

Generalize Zivtech-specific domain names.

| File | Domains |
|------|---------|
| `jawn-ai-platform-overview.jsx` (lines ~58, 150) | `ai.zivtech.com`, `@zivtech.com` |
| `joyus-ai-plan.md` | `demos.zivtech.com` |
| `hosting-comparison.md` (line ~183) | `demos.zivtech.com` |

**Fix:** Replace with `ai.example.com`, `demos.example.com`, or `your-domain.com`.

### 7. Docker Compose Dev Defaults

Add clear warnings about development-only credentials.

| File | What to Fix |
|------|-------------|
| `joyus-ai-mcp-server/docker-compose.yml` (lines ~11, 34) | `POSTGRES_PASSWORD: postgres` — add prominent warning comment |

**Fix:** Add `# WARNING: Development defaults only. Change all passwords for production.` at top of file.

---

## LOW PRIORITY (Nice to have)

### 8. Spec Kitty Metadata

| File | What to Fix |
|------|-------------|
| `.kittify/metadata.yaml` (line ~68) | Personal developer path |

**Fix:** Generalize or remove.

---

## Already Clean

These areas passed review:

- `.gitignore` properly configured (no `.env` files tracked, AI IDE dirs excluded)
- `.env.example` uses proper placeholders (`xxx`, `change-me-in-production`)
- No hardcoded API keys or tokens anywhere in the codebase
- No secrets found in git commit history
- GitHub references are to public repos only

---

## Pre-Release Process

1. Create a branch: `sanitize/open-source-prep`
2. Work through HIGH items first, then MEDIUM
3. Have a second person review the diff
4. Run a final automated scan (e.g., `gitleaks`, `trufflehog`) on the sanitized repo
5. Verify the repo builds and runs without any private dependencies
6. Choose and apply license (see Constitution §2.8 — AGPL or BSL recommended)
7. Add standard open source files: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
8. Make repo public

---

*Created: February 18, 2026*
*Status: Pre-release — all items pending*
