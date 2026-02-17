# Tool Inventory Briefing: Gap Analysis for Platform Plan

**Date:** February 16, 2026
**Source:** Tool & Technology Inventory across 208 Zivtech GitHub repos (70 public + 138 private), filtered to 73 active since 2023.
**Purpose:** Map platform plan technology requirements against existing team skills. Input for Spec Kitty review.

---

## Already in the comfort zone (plan aligns with existing skills)

| Plan Requirement | Existing Experience |
|-----------------|-------------------|
| Express.js MCP server | MCP server already built with Express |
| Docker Compose deployment | ops server, 4+ base containers, all client projects |
| AWS EC2 hosting | AWS S3 already in use (copland); EC2 is new but AWS is not |
| GitHub Actions CI/CD | gh-ai-workflow, zivtech-demos deploy workflow |
| PostgreSQL | Already chosen and in use for MCP server (Drizzle ORM + pg) |
| OAuth 2.0 integrations | Built for Jira, Slack, GitHub, Google in MCP server |
| Git-based skill versioning | Team lives in Git; Claude skills library already structured this way |
| Nginx reverse proxy | Running on ops server today |
| StatiCrypt / GitHub Pages | Already deployed in zivtech-demos |
| Redis (caching/queues) | Used in Lando templates, copland; familiar as infrastructure |
| Monitoring alerts via Slack | Slack integration already built in MCP server |

---

## New territory (plan requires skills not yet in repos)

| Plan Requirement | Gap Description |
|-----------------|----------------|
| **Next.js** (Phase 3 web app) | No Next.js in any repo. React experience is strong (React 18, React Native, Gatsby), so the jump is reasonable but it's still a first. |
| **Claude Agent SDK** (Phase 3 orchestration) | Python SDK, no prior use. Python experience is growing (ai-presentation-toolkit, FastAPI) but Agent SDK is brand new for everyone. |
| **FastAPI at scale** (Phase 3 backend) | One FastAPI app exists (NCLC). Production deployment with auth, multi-tenant isolation, and monitoring is a different scale. |
| **Langfuse** (Phase 3 monitoring) | No prior use. Under evaluation. |
| **Container sandboxing** (Phase 3 code execution) | Docker expertise exists but gVisor/Firecracker-style sandboxing with per-user isolation is new ground. |
| **Playwright** (Phase 4 visual regression) | No Playwright in any repo yet. Backstop.js planned but not implemented. |
| **python-pptx at scale** (Phase 4 presentation toolkit) | ai-presentation-toolkit exists but the full extraction/transformation/assembly pipeline is unbuilt. |

---

## Existing assets the plan doesn't mention but could leverage

| Asset | Potential Relevance |
|-------|-------------------|
| **Jenkins** (active on ops server + base containers) | Could supplement GitHub Actions for heavier CI jobs, or run visual regression tests. Already deployed infrastructure. |
| **ops server** (ops.zivtech.com) | Running Docker Compose with Nginx, MariaDB, Jenkins, Open WebUI. Could host early platform prototypes alongside existing services instead of spinning up new EC2. |
| **Drupal expertise** (40+ active repos, D8-D11) | The platform itself is intentionally TypeScript/Python/React, but Drupal is the primary integration surface: (a) many clients use Drupal and will interact with the platform from their Drupal sites, (b) the future client portal is planned as a Drupal site, (c) deep Drupal knowledge informs what platform tools clients need. |
| **Emulsify / Twig component library** | Relevant for the future Drupal client portal. Already-established theming pattern. |
| **Probo CI** | Still active for some client projects. Could be relevant for the visual regression testing service (PR-based testing is Probo's niche). |
| **Lando + DDEV dual configs** | Local dev pattern already solved. New platform services should fit into this pattern for team adoption. |
| **7 Claude skills** (zivtech-claude-skills) | The plan's skills architecture is more elaborate, but these existing skills demonstrate the team already thinks in skills. Could be migrated into the platform's skill format. |

---

## Summary

The biggest new-to-the-team technologies are **Next.js**, **Claude Agent SDK**, and **container sandboxing**. Everything else either has direct precedent in the repos or is a reasonable extension of existing skills (e.g., AWS EC2 from AWS S3 experience, FastAPI at scale from FastAPI prototype).

Worth noting: the team's deepest skill (Drupal, 40+ active repos) is deliberately not the platform's implementation language — the platform is TypeScript/Python/React by design. But Drupal remains central as the primary **integration surface**: most clients run Drupal, the future client portal will be Drupal, and platform tools will need to work well within Drupal workflows. The team's Drupal expertise directly informs what the platform needs to support.

The ops server at ops.zivtech.com is an underexplored asset — it's already running Docker Compose with Nginx, Jenkins, and Open WebUI in production, which is essentially the same stack the plan calls for on a new EC2 instance.

---

---

## Open Questions Raised by This Inventory

### Local-to-cloud handoff workflow

How does a power user move work between Claude Code (local) and the cloud platform seamlessly?

**Scenario A: Office → Cloud.** Working in Claude Code locally, need to leave but want the work to continue. Type a command, context transfers to the cloud environment, work continues autonomously or semi-autonomously.

**Scenario B: Cloud → Local.** Have work running on the platform, return to computer, want to pull it back into Claude Code and continue locally with full context.

This implies the platform needs:
- A session/context serialization format that both Claude Code and the platform understand
- A CLI command or skill to push/pull active work
- Context continuity — the cloud environment needs to pick up where Claude Code left off (files changed, conversation history, task state)
- Potential integration with Conductor workspaces or git worktrees as the transfer mechanism

This is closely related to the session context management work already spec'd in `kitty-specs/002-session-context-management/`.

### API cost vs. Teams account pricing

The Teams plan includes Claude Code usage at a flat rate. The cloud platform will use the Anthropic API directly, which is usage-based. How much more expensive is the API path?

Key concerns:
- Teams plan is ~$30/user/month with generous Claude Code usage included
- API pricing is per-token (input + output + caching) — a single complex agentic session could cost $5-20+ in API calls
- The platform will be running agentic workloads (multi-step, tool-heavy, long context) which are the most expensive API usage pattern
- Need to model: what does a typical platform session cost via API vs. what it "costs" under the Teams plan?
- This directly impacts pricing for client deployments and whether certain workloads should stay on Claude Code (Teams) vs. route through the platform (API)
- Prompt caching strategy (already in constitution §5.2) and model routing (Haiku → Sonnet → Opus by task complexity) become critical cost controls

---

*Full inventory: see plan file or commit history for the complete 12-section tool & technology inventory across all 208 repos.*
