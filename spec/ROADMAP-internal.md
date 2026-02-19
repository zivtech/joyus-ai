# Joyus AI — Internal Roadmap

**Audience:** Zivtech internal + partners. Not for public repo.
**Will move to:** `joyus-ai-ops/ROADMAP-internal.md` after repo separation.

---

## Phase Timing & Dependencies

| Phase | Name | Status | Depends On | Target |
|-------|------|--------|-----------|--------|
| 1 | Asset Sharing Pipeline | Starting | — | Feb 2026 |
| 2 | MCP Server Deployment | Planned | Phase 1 | Mar 2026 |
| 2.5 | Profile Engine Library | **Priority** | — (standalone) | Mar-Apr 2026 |
| 2.7 | Content Infrastructure (006) | **Spec in progress** | — (standalone) | Apr-May 2026 |
| 3 | Platform Framework | Planned | 2.5, 2.7 | May-Jun 2026 |
| 4 | Additional Tools | Future | Phase 3 | Q3 2026+ |

## Client-Specific Notes

### NCLC (Legal Advocacy)
- **Blocking:** Content Infrastructure (006) for treatise search/verification
- **Blocking:** VoiceContext (5 audience voices: Litigator, Advocate, Educator, Expert, "Priest")
- **Blocking:** Auth integration (Drupal JWT → platform access levels)
- **High value:** Generate-then-verify chat (answer questions, validate against treatise corpus)
- **High value:** Treatise update pipeline (Federal Register → impact map → author-routed draft → review)
- **Needs:** Consumer Law Repository website UI (frontend spec TBD, after 006)
- **Deployment stack:** Drupal + Solr + XML treatises + platform

### Ice Cream Manufacturer/Distributor/Retailer (Food)
- **Needs:** Compliance (FDA/USDA), automated pipelines (daily sales, weekly production)
- **Needs:** Content Management for product specs, cold-chain docs
- **Stack:** TBD

### Hospital (Healthcare)
- **Needs:** Compliance (HIPAA), content management, document generation
- **Critical:** Patient communication voice matching institutional clinical voice
- **Stack:** TBD — likely Epic/Cerner integration

### National Museum
- **Needs:** Content management, document generation, possibly presentation toolkit
- **Stack:** TBD

### Large University
- **Needs:** Compliance (FERPA), analysis tools, document generation
- **Stack:** TBD

### LSAC (Law School Admissions Council)
- **Needs:** Compliance (assessment integrity), analysis tools
- **Stack:** TBD

## Feature Module Taxonomy

Six-tier hierarchy for independently deployable features:

```
Tier 0 — Core (every tenant)
  orchestration, skill-system, session-management, workflow-enforcement,
  mcp-gateway, monitoring-base, multi-tenancy, asset-sharing, audit-trail

Tier 1 — Content Intelligence (opt-in)
  profile-engine, attribution-inline, attribution-async, profile-self-service,
  author-profiles, attribution-service, treatise-pipeline

Tier 2 — Content Management (opt-in)
  knowledge-base, ingestion-pipeline, search, staging,
  deployment-pipeline, canonical-docs

Tier 3 — Compliance (additive)
  hipaa, ferpa, attorney-client, assessment-integrity, fda-usda, data-governance

Tier 4 — Automation & Pipelines (opt-in)
  workflow-engine, scheduled-reports, regulatory-monitor, bug-triage, job-management

Tier 5 — Output Tools (opt-in)
  presentation-toolkit, document-generator, analysis-tools, research-tool,
  code-execution-sandbox, visual-regression-testing, accessibility-scanning

Tier 6 — Infrastructure (deployment layer)
  mcp-server, web-portal, monitoring-stack, container-isolation, hosting-service
```

## Items Not on Public Roadmap

| Item | Phase | Notes |
|------|-------|-------|
| Content staging pipeline | 3 | Stage-to-live content deployment, pairs with 006 |
| Enriched expert profiles | Research Phase 3, Spec Phase 4 | Beyond writing style: subject matter domains, citation networks, knowledge topology |
| A11y scanning service | 4 | Standalone, distinct from visual regression testing |
| Managed hosting | Future (research required) | Do not roadmap until demand validated |
| Bot mediation API | 3 | Universal feature — high market value, every org with content paywall needs this |
| Spec Kitty enterprise partnership | Phase 3-4 | Partner with Spec Kitty to offer enterprise version as a service to our customers. Spec-driven development for clients who can't run Claude Code locally. Expose via platform as "Spec Kitty as Service." |

## Decisions Log (Internal)

| # | Decision | Date | Notes |
|---|----------|------|-------|
| 20 | Platform-agnostic auth (JWT first impl) | Feb 19 | Drupal primary but not only target |
| 21 | VoiceContext 3-layer architecture | Feb 19 | Solves NCLC 5-voice problem |
| 22 | Feature 006 Content Infrastructure | Feb 19 | Knowledge infra gap too large for 005 amendment |

## Repository Separation Plan

| Repo | Content | Visibility |
|------|---------|-----------|
| `joyus-ai` | Platform core, base Docker/compose, example skills, constitution, ROADMAP.md | Public |
| `joyus-ai-ops` | Production deploy/nginx/monitoring, this file (ROADMAP-internal.md) | Private |
| `joyus-ai-internal` | Business docs, research, outreach briefs, legacy specs | Private |

Sanitization checklist at `spec/open-source-sanitization-checklist.md`.

---

*Internal roadmap created: February 19, 2026*
*For: Zivtech team + partners*
