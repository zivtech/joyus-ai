# Implementation Plan: Content Intelligence (Phases A-C)

**Feature**: 005-content-intelligence | **Date**: 2026-02-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/005-content-intelligence/spec.md`

## Summary

Build a Python profile engine library that ingests author corpora, extracts 129 stylometric features, generates hierarchical writing profiles (person → department → organization), emits platform-consumable skill files, and provides two-tier fidelity verification — exposed via CLI and MCP tools. Phase C adds continuous monitoring with drift detection and repair.

This plan remains **voice-first**. The newer `position` and `philosophy`
families are architectural extensions, not hidden scope for Phases A-C.

## Technical Context

**Language/Version**: Python >=3.11, <=3.12 (spaCy 3.x incompatible with Python 3.14)
**Primary Dependencies**: faststylometry 1.0.15, spaCy 3.x (en_core_web_md), Pydantic v2, official `mcp` 1.26 SDK
**Storage**: JSON files (score storage, skill files, monitoring data) — no database
**Testing**: pytest, pytest-cov, pytest-asyncio
**Target Platform**: Linux/macOS (Python package, installable via pip)
**Project Type**: Single Python package (`joyus-profile-engine`) with CLI entry point
**Performance Goals**: Tier 1 verification <500ms, Tier 1 profile build <30s, Tier 2 build <5min
**Constraints**: Python <=3.12, faststylometry Corpus not thread-safe (per-request instances), all MCP output to stderr
**Scale/Scope**: 30+ authors, 4 fidelity tiers, 5 drift signals, 6 repair types

**Compatibility goal**: Existing voice-mode contracts stay valid while the
schema evolves toward profile families.

## Constitution Check

*GATE: Passed*

| Principle | Status | Notes |
|-----------|--------|-------|
| §2.2 Skills as Encoded Knowledge | **Pass** | Skill file emission (SKILL.md + markers.json + stylometrics.json) is the primary output |
| §2.4 Monitor Everything | **Pass** | Phase C monitoring pipeline with 5 drift signals |
| §2.5 Feedback Loops | **Partial** | Repair framework is drift-driven; user correction capture deferred to Phase D (requires generation) |
| §2.7 Automated Pipelines | **Deferred** | Requires System 2 generation (Phase D scope) |
| §2.9 Assumption Awareness | **Pass** | Drift detection = stale assumption detection; profile staleness is an explicit cause |
| §3.2 Compliance Framework | **Partial** | Access control modeled (VoiceAccessLevel); audit trail deferred to Phase D |

## Project Structure

### Documentation (this feature)

```
kitty-specs/005-content-intelligence/
├── spec.md              # Feature specification (3 systems, 12 sections)
├── plan.md              # This file
├── research.md          # Phase 0 research (5 topics, 5 decisions)
├── data-model.md        # Entity definitions (Phase A-C)
├── quickstart.md        # Setup and validation guide
├── contracts/
│   ├── profile-engine-api.md   # Python library + CLI API
│   ├── mcp-tools-api.md       # MCP tool schemas
│   └── philosophy-runtime-contract.md  # Lens-first consumer contract (review/query/compare)
└── tasks/
    └── WP01-WP14.md    # 14 work package prompt files
```

### Source Code (repository root)

```
joyus_profile/                    # Python package (import path)
├── __init__.py
├── models/                       # Pydantic data models
│   ├── corpus.py                 # Corpus, Document, ProcessedCorpus
│   ├── features.py               # StylometricFeatures, MarkerSet, etc.
│   ├── profile.py                # AuthorProfile, VoiceContext, VoiceAccessLevel
│   ├── verification.py           # FidelityScore, VerificationResult
│   └── hierarchy.py              # DepartmentProfile, OrganizationProfile, ProfileHierarchy
├── ingest/                       # Corpus loading and preprocessing
│   ├── loader.py
│   ├── extractors.py
│   └── preprocessor.py
├── analyze/                      # Feature extraction (6 analyzers)
│   ├── stylometric.py            # faststylometry wrapper
│   ├── markers.py
│   ├── vocabulary.py
│   ├── structure.py
│   ├── audience.py
│   └── custom_features.py        # Function words, char n-grams, punctuation
├── profile/                      # Profile generation and hierarchy
│   ├── generator.py
│   ├── composite.py              # CompositeBuilder
│   └── hierarchy.py              # HierarchyManager
├── verify/                       # Two-tier verification
│   ├── inline_checker.py         # Tier 1 (<500ms)
│   ├── deep_analyzer.py          # Tier 2 (full 129-feature)
│   ├── scorer.py                 # FidelityScorer
│   └── feedback.py
├── emit/                         # Skill file emission
│   ├── skill_emitter.py
│   ├── skill_md.py
│   └── validators.py
├── attribute/                    # Cascade attribution (Phase B)
│   ├── cascade.py
│   ├── identifier.py
│   └── outsider.py
├── voice/                        # VoiceContext resolution (Phase B)
│   ├── resolver.py
│   └── access.py
├── monitor/                      # Fidelity monitoring (Phase C)
│   ├── pipeline.py
│   ├── score_store.py
│   ├── rollups.py
│   ├── drift_detector.py
│   ├── diagnosis.py
│   ├── repair.py
│   ├── verify_repair.py
│   ├── alerts.py
│   ├── reports.py
│   ├── config.py
│   └── observability.py
├── mcp_server/                   # MCP tool layer
│   ├── server.py
│   └── tools/
│       ├── profile_tools.py
│       ├── verify_tools.py
│       ├── attribute_tools.py
│       └── monitor_tools.py
├── cli/                          # CLI entry points
│   └── main.py
└── templates/                    # Domain template YAMLs
    ├── legal_advocacy.yaml
    ├── technical.yaml
    ├── marketing.yaml
    └── general.yaml

tests/
├── unit/
│   ├── test_models/
│   ├── test_ingest/
│   ├── test_analyze/
│   ├── test_profile/
│   ├── test_verify/
│   ├── test_voice/
│   └── test_attribute/
├── integration/
│   ├── test_end_to_end.py
│   ├── test_performance.py
│   ├── test_hierarchy_cascade.py
│   ├── test_drift_simulation.py
│   └── test_repair_lifecycle.py
├── regression/
│   ├── test_accuracy.py
│   ├── test_hierarchy_accuracy.py
│   └── test_monitoring_regression.py
└── fixtures/
    ├── example/                  # Sample corpora for testing
    ├── regression/               # Anonymized texts for accuracy tests
    └── monitoring/               # Pre-built score histories
```

## Key Research Decisions

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| R1 | faststylometry 1.0.15 | Complete Burrows' Delta pipeline, minimal deps | research.md §R1 |
| R2 | spaCy en_core_web_md on Python <=3.12 | Best CPU speed/accuracy tradeoff (900K wps, 0.870 dep accuracy, 43MB) | research.md §R2 |
| R3 | Official `mcp` 1.26 SDK, stdio transport | Stable, async-native; FastMCP 3.0 too new | research.md §R3 |
| R4 | Corpus-size weighted mean for composites | Handles unequal contributor volume; incremental update formula available | research.md §R4 |
| R5 | Best-of-N (Phase 1), Constraint Tightening (Phase 2) for generation | Deferred to Phase D implementation | research.md §R5 |

## Phased Delivery

| Phase | WPs | Scope | Priority |
|-------|-----|-------|----------|
| Foundation | WP01 | Package setup, Pydantic models, domain templates, test infra | P0 |
| Phase A: Profile Engine | WP02-WP07 | Ingestion, extraction, generation, verification, MCP, testing | P0-P1 |
| Phase B: Hierarchical Profiles | WP08-WP11 | Composites, hierarchy CRUD, cascade attribution, voice context | P1 |
| Phase C: Fidelity Monitoring | WP12-WP14 | Drift detection, diagnosis/repair, monitoring MCP tools | P2 |

**MVP**: WP01-WP05 (person-level profiles with verification + CLI)

**Parallelization**: After WP04, WP05 (Phase A verification) and WP08 (Phase B composites) can run in parallel.

## Deferred Scope

The following spec sections are intentionally **not covered** in Phases A-C:

| Spec Section | Deferred To | Reason |
|-------------|-------------|--------|
| §5 System 2: Writing Generation | Phase D | Requires LLM integration, content generation pipeline |
| §7 Access Control / Content Provenance | Phase D | SourceRef, GeneratedContent, access_level inheritance need generation pipeline |
| §9 Regulatory Change Detection | Phase F | External API integrations (Federal Register, Congress.gov) |
| §1 Self-Service Profile Building | Phase E | Web interface, automatic tier detection |
| Constitution §2.5 User Correction Feedback | Phase D | No generated content = no user corrections to capture |
| Constitution §2.7 Automated Pipelines | Phase D | Event-driven workflows need generation capability |
| `profile_family=position` runtime artifacts | Later feature | Needs stance graph + chronology contract, not just voice files |
| `profile_family=philosophy` extraction and runtime | Later feature | Needs lens schema, counter-lens logic, and separate verification harness |

### Philosophy Mode Non-Goal for This Plan

Philosophy mode should not be smuggled into current WPs by extending
`VoiceContext`, `SkillEmitter`, or Burrows' Delta scoring. The safe path is:

- keep Phases A-C voice-first
- add family-aware schema and versioning in platform-facing specs
- design philosophy mode as a separate runtime/evaluation track later
