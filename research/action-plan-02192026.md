# Action Plan: Spec Evaluation, Updates & New Work

**Date:** February 19, 2026
**Based on:** `research/architecture-research-report-02192026.md`, `research/joyus-thoughts-02192026.md`
**Method:** Audit of all existing specs → gap analysis → phased action plan

---

## Current State Summary

| Artifact | Status | Key Gap |
|----------|--------|---------|
| **005 spec** (Content Intelligence) | Specified, no plan/tasks | VoiceContext missing; RegisterShift insufficient for multi-audience voices |
| **profile-engine-spec** | Specified, no implementation | No VoiceContext model; no per-voice fidelity tiers |
| **spec/plan.md** | Phase 1-4 roadmap, last updated Feb 11 | Missing Content Infrastructure, bot mediation, voice architecture, roadmap artifacts |
| **spec/constitution.md** | v1.5, published | Sound — no changes needed |
| **006 (Content Infrastructure)** | Does not exist | Blocks NCLC knowledge base, search, access enforcement, bot mediation |
| **Public ROADMAP.md** | Does not exist | Outreach briefs reference capabilities but no formal roadmap |

---

## Phase 1: Spec Updates (Update Existing Artifacts)

These are surgical edits to existing specs based on research findings. No new features — just making what we have correct and complete.

### 1A. Update profile-engine-spec.md — VoiceContext Architecture

**What:** Replace the insufficient `RegisterShift` model with `VoiceContext` as a first-class entity.

**Changes:**
- Add `VoiceContext` model to §3 Profile Schema (section overrides per audience)
- Add `voice_contexts: dict[str, VoiceContext]` to `AuthorProfile`
- Add per-voice fidelity tier field (`fidelity_tier` on VoiceContext, not just AuthorProfile)
- Add `CompositeVoiceConfig` for blended voices like the "Priest" voice
- Document three-layer opt-in: Layer 0 (single voice), Layer 1 (multi-audience), Layer 2 (restricted voices)
- Add `VoiceAccessLevel` for Layer 2

**Design principle:** Backwards-compatible. Layer 0 clients see no change — `voice_contexts` defaults to empty dict, existing `VoiceProfile` fields remain the base voice.

### 1B. Update 005 spec — Voice Architecture + Access Control

**What:** Extend 005 to account for multi-audience voices and voice-level access control.

**Changes:**
1. **§3.3** — Add `VoiceDefinition` to `OrganizationProfile` (voice catalog per org)
2. **§5.3** — Add voice resolution step to generation workflow (before "Load target profile," resolve which VoiceContext applies)
3. **§7.2** — Add **Principle 8**: "Voice profiles carry independent access levels. Statistical patterns remain unrestricted. Positions, analytical frameworks, and example outputs within restricted voice profiles inherit the voice's access level."
4. **§8.2** — Add `voices/` subdirectory to skill file structure
5. **§11** — Resolve open question on Drupal auth: record JWT token exchange decision
6. **§11** — Resolve "RegisterShift" insufficiency question (answered by VoiceContext)

### 1C. Update spec/plan.md — New Phases & Systems

**What:** Update the master plan to reflect systems identified in the research.

**Changes:**
- Add Phase 2.7: Content Infrastructure (between Profile Engine and Platform Framework)
- Add the generate-then-verify chat pattern to Phase 3 scope
- Add bot mediation API to Phase 3 scope
- Record Drupal auth decision (JWT token exchange) in Decision Log
- Update Phase 3 scope to include voice-aware generation
- Note Content Infrastructure as blocking dependency for NCLC knowledge-base features

---

## Phase 2: New Specifications (Create New Artifacts)

### 2A. Create Feature 006 — Content Infrastructure

**What:** New Spec Kitty feature covering the entire "AI reads from a knowledge base" side that's currently unspecified.

**Scope (from research report §2):**
1. **Corpus connector interface** — pluggable connectors for content sources (CMS, XML repos, email archives, file shares)
2. **Search abstraction layer** — `search(query, access_level)` → deployment wires to Solr/Elasticsearch/Drupal Search API
3. **Content state model** — `draft → staged → published → superseded`
4. **Access level mapping interface** — `resolve_access_level(user_token) → ContentAccessLevel`
5. **MCP content search tool** — `search_content(query, filters) → ranked results with citations`
6. **Subscription gating enforcement** — content tagged at ingestion with `access_tier`, filtered at query time
7. **Generate-then-verify chat pattern** — AI commits to answer before retrieval, then validates against corpus
8. **Bot mediation API** — AI-optimized endpoint (cacheable, access-aware, rate-limited)

**Approach:** Use Spec Kitty workflow: `specify` → `clarify` → `plan` → `tasks` → implement.

**Reference plugins to study first:**
- `knowledge-work-plugins/enterprise-search/` — search decomposition pattern
- `knowledge-work-plugins/customer-support/` — triage→research→draft pattern
- `knowledge-work-plugins/legal/` — playbook-based review pattern

### 2B. Create Public ROADMAP.md

**What:** Community-facing roadmap using capability language (not client language).

**Structure:**
```
## Shipped
## In Development
## Planned
## Under Evaluation
```

**Placement:** `joyus-ai/ROADMAP.md` (public repo root)

### 2C. Create Internal ROADMAP-internal.md

**What:** Phase-detailed internal roadmap with client-specific notes.

**Placement:** `joyus-ai-ops/ROADMAP-internal.md` (private repo — requires repo separation first, or temporarily in `spec/` until separation happens)

---

## Phase 3: Implementation Sequencing

Once specs are updated and 006 is written, here's the implementation order driven by dependencies:

```
                    ┌─────────────────────────┐
                    │  1A. Update profile-     │
                    │  engine-spec (VoiceCtx)  │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                   ▼
    ┌──────────────┐  ┌──────────────┐   ┌──────────────────┐
    │ 1B. Update   │  │ 2B. Public   │   │ 1C. Update       │
    │ 005 spec     │  │ ROADMAP.md   │   │ spec/plan.md     │
    └──────┬───────┘  └──────────────┘   └──────────────────┘
           │
           ▼
    ┌──────────────┐
    │ 2A. Specify  │
    │ Feature 006  │
    └──────┬───────┘
           │
           ▼
    ┌──────────────────────────────────────────────┐
    │  005: plan → tasks → implement               │
    │  (Profile Engine is Phase A-B of 005)        │
    │  VoiceContext implementation is Phase B       │
    └──────┬───────────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────────────────┐
    │  006: plan → tasks → implement               │
    │  (Blocks NCLC knowledge base features)       │
    │  Depends on 005 Profile Engine for           │
    │  access control integration                  │
    └──────────────────────────────────────────────┘
```

### Implementation Priority (What to Do First)

**Batch 1 — Spec work (can be done now, in parallel):**
- [1A] Update profile-engine-spec.md with VoiceContext
- [1B] Update 005 spec with voice architecture + Principle 8
- [1C] Update spec/plan.md with new phases
- [2B] Create ROADMAP.md

**Batch 2 — New specification (after Batch 1):**
- [2A] Specify Feature 006 (Content Infrastructure) via Spec Kitty
- [2C] Create internal roadmap (can happen in parallel with 006)

**Batch 3 — Plan & task 005 (after Batch 1):**
- Run `spec-kitty plan` on 005 (now that the spec is updated)
- Run `spec-kitty tasks` on 005
- Begin implementation: Phase A (Profile Engine library) first

**Batch 4 — Plan & task 006 (after Batch 2):**
- Run `spec-kitty plan` on 006
- Run `spec-kitty tasks` on 006
- Begin implementation (likely Phase 3 timeline in the master plan)

---

## Decisions Needed Before Starting

| # | Decision | Recommendation | Impact |
|---|----------|---------------|--------|
| 1 | **Adopt VoiceContext 3-layer architecture?** | Yes — backwards-compatible, solves the NCLC voice problem cleanly | Affects profile-engine-spec, 005 spec, future implementation |
| 2 | **Drupal auth: JWT token exchange?** | Yes — Drupal issues scoped JWT, platform validates stateless | Affects 005 §11, 006 access mapping interface |
| 3 | **New Spec Kitty feature 006 for Content Infrastructure?** | Yes — the knowledge infrastructure gap is too large for a 005 amendment | Creates new feature in `kitty-specs/006-content-infrastructure/` |
| 4 | **Generate-then-verify pattern: in 005 or 006?** | 006 — it's a knowledge-base interaction pattern, not a content generation pattern | Affects 006 scope |
| 5 | **Plugin compatibility layer (Cowork manifest format)?** | Defer — note in roadmap as "Under Evaluation" | No immediate action needed |
| 6 | **Where does internal roadmap live before repo separation?** | `spec/ROADMAP-internal.md` temporarily | Will move to joyus-ai-ops when separation happens |

---

## Estimated Effort

| Work Item | Effort | Notes |
|-----------|--------|-------|
| Batch 1 (spec updates + ROADMAP) | 1 session | Surgical edits, well-defined scope |
| Batch 2 (006 specification) | 1-2 sessions | New spec, but research report provides 80% of the content |
| Batch 3 (005 plan + tasks) | 1 session | Spec is thorough, plan/tasks flow from it |
| Batch 4 (006 plan + tasks) | 1 session | After spec is written |
| 005 Phase A implementation (Profile Engine) | 2-3 weeks | Per existing estimate in spec/plan.md |
| 005 Phase B implementation (Hierarchical + Voice) | 2 weeks | VoiceContext adds ~1 week to original estimate |
| 006 implementation | TBD | Depends on scope decisions and search backend choice |

---

## What We're NOT Doing Yet

These items from the research are explicitly deferred:

| Item | Why Deferred | When |
|------|-------------|------|
| Enriched expert profiles (beyond writing style) | Research needed first — subject matter domains, citation networks | After 005 Phase B |
| Hosting-as-a-product | Demand not validated | Far future |
| A11y scanning service | Useful but not blocking | Phase 4+ |
| Stage-to-live content deployment | Needs content infrastructure first | After 006 |
| Consumer Law Repository website UI | Frontend spec needed, depends on 006 | After 006 |
| Plugin compatibility layer | Interesting but not urgent | Under evaluation |
| Forking official plugins | Study patterns first, fork when implementing | During 005/006 implementation |

---

*Plan generated from architecture research report (5 parallel agents + cross-validation) and full audit of existing specs (~25,000 words across 11 documents).*
