# Joyus AI Architecture Research Report

**Date:** February 19, 2026
**Source:** `research/joyus-thoughts-02192026.md`
**Method:** 5 parallel research stages + cross-validation

---

## Executive Summary

Alex's architecture notes identify 16 explicit systems and 6 implied systems needed for the platform. After auditing all existing specs (~25,000 words across 11 documents), the research reveals a structural split: the **generation/fidelity side** (profiles, attribution, voice matching) is ~85% specified and well-designed. The **knowledge infrastructure side** (content indexing, search, access enforcement, staging, bot mediation) has near-zero specification. This is the primary gap.

Three critical findings require immediate architectural decisions:
1. **Voice profiles need first-class status** — the current `RegisterShift` model is insufficient for NCLC's 5 distinct audience voices
2. **A Content Infrastructure spec (006) is needed** — covering corpus ingestion, search, access enforcement, and the AI-optimized bot API
3. **Voice-level access control is architecturally novel** — the "Priest" voice is itself a restricted asset, not just the content it produces

---

## Coverage Map

### What's Well-Specified (Build Confidence: High)

| System | Spec Location | Coverage |
|--------|---------------|----------|
| Author profiles (129-feature stylometric) | 005 §3-4, profile-engine-spec | ~95% |
| Attribution/verification (inline + async) | 005 §5.3, §6 | ~90% |
| Federal Register monitoring pipeline | 005 §9 | ~85% |
| Treatise update pipeline (7-step) | 005 §5.4 | ~85% |
| Access control policy (partial access, full awareness) | 005 §7 | ~85% |
| Fidelity tiers (4 levels) | 005 §5.6 | ~90% |
| Session management | Feature 002 | Shipped |
| Workflow enforcement | Feature 004 | Shipped |

### What's Partially Specified (Needs Extension)

| System | What Exists | What's Missing |
|--------|-------------|----------------|
| Multi-audience voices | `audience_registers: dict[str, RegisterShift]` slot exists | RegisterShift is a delta on voice params only; NCLC voices differ across ALL 12 profile sections |
| Drupal access control | ContentAccessLevel enum, 7 principles | Integration mechanism (how Drupal permissions map to platform access levels) |
| Consumer Law Repository | Backend pipeline (regulatory detection, draft generation) | Website UI, XML write-back, expert review queue, "future regulations" feature |
| Accessibility | Referenced in quality gates, visual regression testing | Standalone a11y scanning service, automated remediation workflow |

### What's Missing Entirely (New Specs Needed)

| System | Why It Matters | Priority |
|--------|---------------|----------|
| Searchable content database | Blocks treatise verification, RAG chat, and all knowledge-base features | **Tier 1** |
| Drupal auth integration mechanism | Blocks all access-gated content | **Tier 1** |
| Voice/skill-level access control | Blocks the "Priest" voice (most important NCLC voice) | **Tier 1** |
| Generate-then-verify chat pattern | Distinct from content generation — user asks question, AI guesses, then verifies against corpus | **Tier 1** |
| Mediated bot search API | AI bots hammering site search — universal problem, not NCLC-specific | **Tier 2** |
| Content ingestion pipeline | How XML + Drupal + web + listservs become a queryable knowledge base | **Tier 2** |
| Stage-to-live content deployment | Content promotion pipeline (separate from code CI/CD) | **Tier 2** |
| Public roadmap | No ROADMAP.md exists; outreach briefs have prose snapshots only | **Tier 2** |
| MCP content search tool | Interface layer between AI agents and the content knowledge base | **Tier 2** |
| Solr search integration | Past research suggested Solr; no decision record or spec exists | **Tier 2** |
| Enriched AI-focused expert profiles | Beyond writing style — subject matter domains, citation networks, knowledge topology | **Tier 3** |
| Hosting service | Far future; needs independent demand/ops research first | **Tier 3** |

---

## Key Architectural Recommendations

### 1. VoiceContext as First-Class Entity (HIGH PRIORITY)

**Problem:** The current `RegisterShift` model treats audience as a parameter tweak on a single voice. NCLC's 5 voices (Litigator, Advocate, Educator, Expert, Consumer Advocate "Priest") differ across vocabulary, argumentation, citations, structure, and positions — not just tone.

**Recommendation:** Add `VoiceContext` with section overrides to the profile schema.

**Three-layer opt-in design:**
- **Layer 0 (all clients):** Single AuthorProfile, one voice. Existing spec unchanged.
- **Layer 1 (multi-audience orgs):** VoiceContext objects override specific profile sections per audience. No access restrictions on voices.
- **Layer 2 (restricted voice orgs):** VoiceAccessLevel on VoiceContext. Voice profiles themselves are access-gated.

**Per-voice fidelity:** An author may be Tier 4 for Expert voice (50K+ words of treatise) but Tier 2 for Advocate voice (5K words of testimony). Fidelity tier should be stored per VoiceContext, not per AuthorProfile.

**Composite voices:** Voice (e) "Priest" blends other voices + restricted "secrets." Needs a `CompositeVoiceConfig` that defines source voices, weights, and additional restricted corpus.

**New Principle for 005 §7.2:**
> **Principle 8: Voice profiles carry independent access levels.** Statistical patterns (markers, stylometrics) remain unrestricted. Positions, analytical frameworks, and example outputs within restricted voice profiles inherit the voice's access level.

**Spec changes needed:**
- `profile-engine-spec.md`: Add `VoiceContext` model, modify `AuthorProfile` to include `voice_contexts: dict[str, VoiceContext]`
- `005/spec.md §3.3`: Add `VoiceDefinition` to `OrganizationProfile`
- `005/spec.md §5.3`: Add voice resolution step to generation workflow
- `005/spec.md §7.2`: Add Principle 8 (voice-level access)
- `005/spec.md §8.2`: Add `voices/` subdirectory to skill file structure

### 2. Content Infrastructure Specification — New Spec 006 (HIGH PRIORITY)

**Problem:** Specs are strong on the "AI produces content" side but have near-zero coverage for "AI reads from a knowledge base." The NCLC use case requires both.

**Proposed 006 scope:**
1. **Corpus connector interface** — pluggable connectors for content sources (CMS, XML repository, email archive, file share)
2. **Search abstraction layer** — platform calls `search(query, access_level)`, deployment wires to Solr/Elasticsearch/Drupal Search API
3. **Content state model** — `draft → staged → published → superseded` tracked on all content
4. **Access level mapping interface** — deployment implements `resolve_access_level(user_token) → ContentAccessLevel`
5. **MCP content search tool** — `search_content(query, filters) → ranked results with citations`
6. **Subscription gating enforcement** — content tagged at ingestion with `access_tier`, filtered at query time

**Key decision:** Platform provides search abstraction, tenant wires backend (recommended). Don't duplicate NCLC's existing Solr infrastructure.

### 3. AI-Optimized Bot API — Universal Platform Feature (MEDIUM PRIORITY)

**Problem:** AI crawlers hit site searches too hard, causing traffic spikes for obscure/unavailable content.

**This is universal, not NCLC-specific.** Every org with a content paywall faces this.

**Proposed design:**
- Well-known endpoint (`/api/ai-content` or llms.txt standard)
- JSON responses with content, citations, access_level, subscribe_pointer
- CDN-cacheable (5-10min TTL for regulatory changes, 24hr for stable doctrine)
- Rate limited with User-Agent verification
- "Partial access, full awareness" response structure (existing §7.2 Principle 6)
- Cache invalidated when treatise update pipeline publishes changes

### 4. Generate-Then-Verify Chat Pattern (HIGH PRIORITY for NCLC)

**Problem:** The spec assumes "write in a voice" but NCLC also needs "answer a question and verify against the corpus."

**Two-step pattern:**
1. AI generates a candidate answer (commits to a position before seeing sources)
2. AI verifies against retrieved treatise content
3. If inconsistent → correct or flag with authoritative reference

**Why generate-then-verify, not retrieve-then-generate (standard RAG):** For legal content, having the model commit before retrieval prevents anchoring bias. The model states its position, then the system validates it. This catches cases where the model "knows" something that contradicts current treatise text.

**Platform-level capability:** Any tenant with a structured knowledge base (hospital protocols, case law, product specs) benefits from this pattern.

### 5. Drupal Auth Integration — Token Exchange (BLOCKS EVERYTHING)

**Recommendation:** Drupal issues a scoped JWT on user login; the platform validates the JWT and trusts its claims. Drupal remains the authority; the platform stays stateless.

**Why not Drupal module:** Maintenance burden, coupling to Drupal version lifecycle.
**Why not auth passthrough:** Requires callback to Drupal on every request; slower, less scalable.

---

## Feature Module Taxonomy

Six-tier hierarchy for independently deployable platform features:

```
Tier 0 — Core (every tenant)
  orchestration, skill-system, session-management, workflow-enforcement,
  mcp-gateway, monitoring-base, multi-tenancy, asset-sharing, audit-trail

Tier 1 — Content Intelligence (opt-in: expert voice, attribution)
  profile-engine, attribution-inline, attribution-async, profile-self-service,
  author-profiles, attribution-service, treatise-pipeline

Tier 2 — Content Management (opt-in: knowledge base, staging)
  knowledge-base, ingestion-pipeline, search, staging,
  deployment-pipeline, canonical-docs

Tier 3 — Compliance (additive: declare which frameworks apply)
  hipaa, ferpa, attorney-client, assessment-integrity, fda-usda, data-governance

Tier 4 — Automation & Pipelines (opt-in: event-driven workflows)
  workflow-engine, scheduled-reports, regulatory-monitor, bug-triage, job-management

Tier 5 — Output Tools (opt-in: presentations, documents, code)
  presentation-toolkit, document-generator, analysis-tools, research-tool,
  code-execution-sandbox, visual-regression-testing, accessibility-scanning

Tier 6 — Infrastructure (deployment layer, private repos)
  mcp-server, web-portal, monitoring-stack, container-isolation, hosting-service
```

**Example tenant configurations:**
- **NCLC (legal advocacy):** Core + Content Intelligence (full) + Content Management + Compliance (attorney-client) + Automation (regulatory-monitor)
- **Food manufacturer:** Core + Content Management + Compliance (FDA/USDA) + Automation (scheduled reports) + Output Tools (document-generator)
- **Hospital:** Core + Compliance (HIPAA) + Content Management + Output Tools (document-generator, analysis-tools)
- **University:** Core + Compliance (FERPA) + Content Management + Output Tools (analysis-tools, document-generator)

---

## Roadmap Recommendations

### Public Roadmap (ROADMAP.md in joyus-ai)

Use capability language, not client language. "Regulatory change detection pipeline" not "NCLC Federal Register monitoring."

**Shipped:** MCP Server, Session Management, Workflow Enforcement, Web Chat UI, Content Attribution Engine
**In Development:** Asset Sharing, Platform Framework, Writing Profile Engine, Content Intelligence Monitoring, Compliance Modules, Automated Pipelines
**Roadmap:** Presentation Toolkit, Document Generator, Analysis Tools, Regulatory Change Detection, Expert Voice Routing, Visual Regression & A11y Testing, Content Staging, Knowledge Base Ingestion, Attribution Service, Code Execution Sandbox
**Under Evaluation:** Industry-Specific Pipeline Integrations, Compliance Framework Extensions, Enriched Expert Profiles, Managed Hosting

### Internal Roadmap Additions (ROADMAP-internal.md in joyus-ai-ops)

| Item | Phase | Notes |
|------|-------|-------|
| Content staging pipeline | Phase 3 | New — not in current plan |
| Stage-to-live deployment | Phase 3 | Pairs with staging |
| Enriched expert profiles | Research Phase 3, Spec Phase 4 | Beyond writing style into subject matter domains |
| A11y scanning service | Phase 4 | Distinct from visual regression testing |
| Managed hosting | Future (research required) | Do not roadmap until demand validated |
| Bot mediation API | Phase 3 | Universal feature, high market value |
| Content Infrastructure spec (006) | Phase 3 | Blocks NCLC knowledge base features |

### Repository Placement

| Artifact | Repo | Rationale |
|----------|------|-----------|
| ROADMAP.md | joyus-ai (public) | Community-facing, no client details |
| ROADMAP-internal.md | joyus-ai-ops (private) | Phase details, client-specific notes |
| spec/plan.md | joyus-ai-internal (private) | Too detailed for public even post-sanitization |
| spec/constitution.md | joyus-ai (public) | The constitution IS the public identity |
| spec/005-content-intelligence/ | joyus-ai (public) | Demonstrates technical depth |
| outreach briefs | joyus-ai-internal (private) | Business materials |

---

## Cross-Validation Issues Resolved

| Issue | Resolution |
|-------|------------|
| Multi-audience voice miscategorized as COVERED | Reclassified to PARTIALLY COVERED. VoiceContext recommendation stands. |
| "AI chat verification" ≠ "RAG chat verification" | Split into: (a) Output Fidelity Monitoring [COVERED], (b) Corpus-grounded RAG Verification [NOT DESIGNED] |
| Drupal auth must precede voice access control | Corrected priority: (1) Drupal auth JWT, (2) Skill/voice access control |
| "Skill-level access control" = "voice-level access control" | Same mechanism — voices are writing skill payloads. One spec section covers both. |
| Subscription gating absent from all stages | Added to 006 spec requirements — tag content at ingestion with access_tier, filter at query time |
| MCP content search tool missing from 006 proposal | Added as explicit 006 deliverable |

---

## Priority Action Register

**Tier 1 — Blocks NCLC deployment:**
1. Drupal auth integration decision (JWT token exchange) → record in spec/plan.md §8 Decision Log
2. VoiceContext first-class entity → update profile-engine-spec.md + 005 spec
3. Content Infrastructure spec (006) → new feature spec covering search, ingestion, access enforcement
4. Generate-then-verify chat pattern → add to 005 or new chat interface spec
5. CLR website expert review queue UI → frontend spec for treatise update pipeline

**Tier 2 — Before Phase 3 launch:**
6. Content ingestion pipeline (XML + Drupal + web + listservs)
7. Stage-to-live content deployment pipeline
8. MCP content search tool
9. Public ROADMAP.md
10. Formal feature-to-tenant-niche catalog

**Tier 3 — Before scale:**
11. Mediated bot search API (universal platform feature)
12. A11y remediation workflow
13. Enriched expert profiles (research first)
14. Hosting-as-a-product (research first)

---

## Appendix: NCLC Voice Definitions

| Voice | Audience | Characteristics | Access Level |
|-------|----------|-----------------|--------------|
| (a) Litigator | Courts | Legal precision, citation-heavy, adversarial argumentation, formal | SUBSCRIBER |
| (b) Advocate | Legislators | Policy-focused, evidence hierarchy, persuasive, accessible-formal | PUBLIC |
| (c) Educator | Public | Simplified language, explanatory, empowering, jargon-free | PUBLIC |
| (d) Expert | Peers/academics | Treatise-quality, comprehensive, analytical, nuanced | SUBSCRIBER |
| (e) Consumer Advocate "Priest" | Practicing lawyers | Composite of (a)-(d) + restricted strategies ("secrets"), teaching voice | INTERNAL |

---

---

## Official Plugins & SDK Evaluation

Three Anthropic repos were evaluated for adaptable patterns: `claude-plugins-official` (29 plugins), `knowledge-work-plugins` (11 domain plugins), and `claude-agent-sdk-demos` (6 demos).

### HIGH RELEVANCE — Adapt These

| Plugin/Demo | Repo | Maps To | How to Adapt |
|-------------|------|---------|--------------|
| **enterprise-search** | knowledge-work-plugins | Content Infrastructure (006), knowledge base search | The search decomposition pattern (one query → multi-source search → synthesis with source attribution) is exactly the search abstraction layer we need. The 3 skills (Search Strategy, Source Management, Knowledge Synthesis) map directly to the corpus connector interface. Adapt: replace Slack/email/wiki sources with XML treatises, Drupal CMS, and listserv archives. |
| **legal** | knowledge-work-plugins | Compliance skills, NCLC workflows | The playbook-based review pattern (standard positions → acceptable ranges → escalation triggers) is architecturally identical to our compliance skill pattern. The GREEN/YELLOW/RED triage classification maps to quality gate severity. Adapt: swap contract review playbook for NCLC's legal voice requirements and access control rules. |
| **code-review** (Boris Cherny) | claude-plugins-official | Automated quality gates, content fidelity monitoring | Confidence-scored multi-agent review (4 parallel agents, each reviews from different angle, issues scored 0-100, filtered at threshold 80) is exactly the pattern for our two-tier content verification. Adapt: replace "CLAUDE.md compliance" with "voice fidelity compliance," replace "bug detection" with "factual accuracy against treatise corpus." |
| **customer-support** | knowledge-work-plugins | Generate-then-verify chat, knowledge management | The triage → research → draft → escalation workflow maps to our RAG chat pattern. The KB article generation from resolved issues maps to self-service profile building (turn resolved content queries into reusable knowledge). Adapt: replace Intercom/HubSpot connectors with Drupal/Solr connectors. |
| **hookify** | claude-plugins-official | Workflow enforcement, compliance rule enforcement | Pattern-matching hook system (regex on events → block/warn actions) maps to quality gate enforcement and compliance hard-failure patterns. Already file-based markdown config. Adapt: extend event types beyond bash/file to include "content generation" and "voice selection" events. |
| **research-agent** | claude-agent-sdk-demos | Automated pipelines, regulatory monitoring | Multi-agent pattern (lead → parallel researchers → data analyst → report writer) with SDK hooks for tracking maps directly to the regulatory change detection pipeline (monitor → impact map → route → draft → review). The hook-based subagent tracking is exactly what we need for audit trail. |

### MEDIUM RELEVANCE — Reference Patterns

| Plugin/Demo | Repo | Maps To | Value |
|-------------|------|---------|-------|
| **data** | knowledge-work-plugins | Analysis tools (Tier 5) | SQL queries, data exploration, visualization, dashboards, and the `/validate` command (methodology + accuracy + bias checks before sharing) maps to our analysis tools module. The validation pattern is reusable for any output quality gate. |
| **pr-review-toolkit** | claude-plugins-official | Content verification system | 6 specialized review agents (comment accuracy, test coverage, error handling, type design, code quality, simplification) — the multi-perspective parallel review pattern informs our two-tier content verification. Each perspective is independently scored and prioritized. |
| **feature-dev** | claude-plugins-official | Spec Kitty integration | 7-phase workflow (Discovery → Exploration → Clarification → Architecture → Implementation → Review → Summary) maps closely to Spec Kitty's lifecycle. The code-explorer, code-architect, and code-reviewer agents could be adapted as platform-level development agents. |
| **bio-research** | knowledge-work-plugins | Domain plugin architecture | 10 MCP connectors + 5 analysis skills bundled as one domain-specific plugin — this is the model for how NCLC-specific plugins should be structured. Shows how to bundle domain databases, analysis tools, and workflows into a single installable package. |
| **skill-creator** | claude-plugins-official | Self-service profile/skill building (Phase E) | Creates, improves, and evaluates skills. Directly relevant to self-service profile building where users upload writing samples and get a writing skill back. The eval/benchmark pattern is useful for measuring skill quality. |
| **product-management** | knowledge-work-plugins | Roadmap management, spec writing | The `/write-spec`, `/roadmap-update`, and `/stakeholder-update` commands are reference patterns for how we expose platform management capabilities. The research synthesis skill maps to our content intelligence analysis. |

### LOW RELEVANCE — Note for Later

| Plugin/Demo | Why Low | Note |
|-------------|---------|------|
| frontend-design | UI-specific, not architectural | Reference when building web portal UI |
| LSP plugins (8 languages) | Dev tooling | Already have LSP through OMC |
| email-agent | IMAP email demo | Could inform mediated bot API endpoint design |
| excel-demo, resume-generator | Simple demos | Not architecturally relevant |
| sales, marketing, finance | Domain plugins | Different domains, but useful as templates if we add those verticals |
| productivity | Task/calendar workflows | Reference for personal productivity features |

### Key Architectural Insight

The knowledge-work-plugins architecture is **remarkably aligned** with our Constitution §2.2 "Skills as Encoded Knowledge." Their plugin structure:

```
plugin-name/
├── .claude-plugin/plugin.json   # Manifest
├── .mcp.json                    # Tool connections
├── commands/                    # Slash commands
└── skills/                      # Domain knowledge
```

maps directly to our skill system design:

```
tenant-skills/
├── skill-registry.json          # Manifest
├── connectors/                  # MCP/tool connections
├── workflows/                   # Triggered workflows
└── skills/                      # Domain knowledge (SKILL.md files)
```

The file-based, markdown-first, no-code approach is identical. The difference is that our skills enforce compliance as hard failures and carry access control — their plugins are advisory. We should adopt their plugin manifest format (`.claude-plugin/plugin.json`) as a compatibility layer so Joyus AI tenants can install standard Cowork/Claude Code plugins alongside their compliance-enforced skills.

### Recommended Actions

1. **Fork and adapt `enterprise-search`** as the starting point for Content Infrastructure spec (006). The search strategy, source management, and knowledge synthesis skills save significant spec work. Replace their MCP connectors with our corpus connector interface.

2. **Study Boris Cherny's `code-review` confidence scoring** for the content fidelity monitoring system. The 0-100 scoring with threshold filtering is the right model for voice fidelity checks. This is the same Boris Cherny whose "thin orchestration" analysis we reference in the platform brief.

3. **Adopt the knowledge-work-plugins manifest format** as a compatibility standard. This lets tenants use any Cowork plugin alongside Joyus AI's compliance-enforced skills. The plugin system becomes a superset — standard plugins for convenience, Joyus AI skills for enforcement.

4. **Use the `legal` plugin as a template** for NCLC's first skill pack. The playbook configuration pattern (standard positions, acceptable ranges, escalation triggers) translates directly to voice access rules and content restriction policies.

5. **Reference `research-agent`'s SDK hooks pattern** for the audit trail and agent attribution system. Their pre/post tool use hooks with `parent_tool_use_id` tracking is exactly the observability layer we need.

6. **Use `bio-research` as the structural model** for domain-specific plugin bundles. It demonstrates how to package 10+ data source connectors with 5+ analysis workflows as a single installable unit — this is how NCLC's treatise pipeline, regulatory monitor, and voice profiles should ship.

---

*Research conducted by 5 parallel agents (2 scientists, 2 architects, 1 product manager) with cross-validation, plus 3 repo exploration passes. Raw findings in `.omc/scientist/reports/`.*
