# Tasks: Content Intelligence (Phases A-C)

**Feature**: 005-content-intelligence
**Date**: 2026-02-19
**Scope**: Phase A (Profile Engine), Phase B (Hierarchical Profiles), Phase C (Fidelity Monitoring)
**Work Packages**: 14 | **Subtasks**: 73

---

## Subtask Registry

| ID | Description | WP | Parallel | Dependencies |
|----|-------------|-----|----------|-------------|
| T001 | Initialize pyproject.toml with dependencies and dev tooling | WP01 | | — |
| T002 | Define Pydantic models for corpus types | WP01 | [P] | T001 |
| T003 | Define Pydantic models for feature types | WP01 | [P] | T001 |
| T004 | Define Pydantic models for profile types (AuthorProfile, VoiceContext) | WP01 | [P] | T001 |
| T005 | Define Pydantic models for verification types | WP01 | [P] | T001 |
| T006 | Create domain template YAML schema and 4 templates | WP01 | | T004 |
| T007 | Set up test infrastructure with conftest.py and fixtures | WP01 | | T001 |
| T008 | Implement CorpusLoader (directory, files, URLs, text) | WP02 | | T002 |
| T009 | Implement format extractors (PDF, DOCX, HTML, MD, TXT) | WP02 | [P] | T008 |
| T010 | Implement Preprocessor (normalize, clean, segment) | WP02 | | T008 |
| T011 | Unit tests for ingestion pipeline | WP02 | | T009, T010 |
| T012 | Implement StylometricAnalyzer (faststylometry wrapper) | WP03 | | T002 |
| T013 | Implement custom feature extraction (function words, sentence length, punctuation, char n-grams) | WP03 | [P] | T012 |
| T014 | Implement MarkerAnalyzer (domain-specific term/phrase identification) | WP03 | [P] | T002 |
| T015 | Implement VocabularyAnalyzer (preferred/avoided terms, signature phrases) | WP03 | [P] | T002 |
| T016 | Implement StructureAnalyzer (document/paragraph/sentence patterns) | WP03 | [P] | T002 |
| T017 | Implement AudienceAnalyzer (register detection) | WP03 | [P] | T002 |
| T018 | Regression tests for feature extraction consistency | WP03 | | T012-T017 |
| T019 | Implement ProfileGenerator.build() (features → 12-section AuthorProfile) | WP04 | | T003-T005 |
| T020 | Domain-aware section weighting (legal, technical, marketing, general) | WP04 | | T019 |
| T021 | VoiceContext population from corpus analysis (Layer 0) | WP04 | | T019 |
| T022 | Confidence scoring based on corpus size and feature stability | WP04 | | T019 |
| T023 | Implement SkillEmitter.emit() (profile → SKILL.md + markers.json + stylometrics.json) | WP04 | | T019 |
| T024 | Implement skill_md.py (human/Claude-readable Markdown from profile sections) | WP04 | | T023 |
| T025 | Implement validators.py (schema validation for emitted files) | WP04 | | T023 |
| T026 | Implement CLI build command | WP05 | | T023 |
| T027 | Implement InlineChecker (Tier 1: marker presence + basic stylometric distance, <500ms) | WP05 | | T005, T012, T014 |
| T028 | Implement DeepAnalyzer (Tier 2: full 129-feature Burrows' Delta) | WP05 | [P] | T005, T012 |
| T029 | Implement FidelityScorer (unified 0.0-1.0 score with per-feature breakdown) | WP05 | | T027, T028 |
| T030 | Implement feedback.py (actionable feedback for model self-correction) | WP05 | | T029 |
| T031 | Implement CLI verify command | WP05 | | T029 |
| T032 | Implement MCP server entry point (official `mcp` SDK, stdio transport) | WP06 | | T001 |
| T033 | Implement profile MCP tools (build_profile, get_profile, compare_profiles) | WP06 | | T019, T023, T032 |
| T034 | Implement verify MCP tools (verify_content, check_fidelity) | WP06 | [P] | T029, T032 |
| T035 | Integration tests for MCP tool calls | WP06 | | T033, T034 |
| T036 | Port PoC accuracy tests (>=94.6% 4-author, >=97.9% 9-author) | WP07 | | T029 |
| T037 | End-to-end test: corpus → profile → skill files → verify | WP07 | | T023, T029 |
| T038 | Performance tests: Tier 1 <500ms, profile build times per tier | WP07 | [P] | T027, T019 |
| T039 | Implement CompositeBuilder.build_department() (weighted mean) | WP08 | | T004 |
| T040 | Implement CompositeBuilder.build_organization() (dept composites + editorial layer) | WP08 | | T039 |
| T041 | Define hierarchy Pydantic models (DepartmentProfile, OrganizationProfile, ProfileHierarchy) | WP08 | | T004 |
| T042 | Topic-based department model (people belong to multiple expertise areas) | WP08 | | T041 |
| T043 | Implement HierarchyManager CRUD (add/remove people, rebuild composites) | WP09 | | T039, T041 |
| T044 | Cascade org-level changes (prohibited framings, position updates) | WP09 | | T043 |
| T045 | Profile diffing (what changed between profile versions) | WP09 | [P] | T041 |
| T046 | Skill file emission for full hierarchy (org/, departments/*/, people/*/) | WP09 | | T023, T043 |
| T047 | Implement cascade attribution engine (person → dept → org → outsider) | WP10 | | T041, T029 |
| T048 | Implement author identifier (ranked candidate list, no target) | WP10 | | T047 |
| T049 | Implement outsider detection | WP10 | | T047 |
| T050 | Attribution MCP tools (identify_author, validate_attribution, detect_outsider) | WP10 | | T032, T047-T049 |
| T051 | Implement VoiceResolver.resolve() (base profile + voice overrides + hierarchy merge) | WP11 | | T004, T041 |
| T052 | Implement AccessChecker (VoiceAccessLevel for requesting user) | WP11 | | T051 |
| T053 | Test Layer 0/1/2 voice behavior | WP11 | | T051, T052 |
| T054 | Unit tests: composite building, inheritance, cascade | WP11 | | T039, T047 |
| T055 | Integration test: full hierarchy (org + 2 depts + 5 people) + attribution cascade | WP11 | | T043, T047 |
| T056 | Accuracy tests: dept >=90%, org >=85%, outsider >=95% | WP11 | | T055 |
| T057 | Implement monitoring pipeline (Tier 2 analysis queue for generated outputs) | WP12 | | T028 |
| T058 | Score storage (JSON-based monitoring data, per-profile, per-content-type) | WP12 | | T057 |
| T059 | Daily/weekly rollup aggregation | WP12 | | T058 |
| T060 | Implement five drift signals (fidelity decline, marker shift, stylometric distance, negative increase, inconsistency) | WP12 | | T058 |
| T061 | Configurable thresholds per profile | WP12 | | T060 |
| T062 | Alert generation with severity classification | WP12 | | T060 |
| T063 | Implement diagnosis engine (what drifted + probable cause) | WP13 | | T060 |
| T064 | Feature-level attribution (which of 129 features are drifting) | WP13 | | T063 |
| T065 | Human-readable diagnostic reports | WP13 | | T063 |
| T066 | Implement repair action framework (6 repair types) | WP13 | | T063 |
| T067 | Repair verification: regression + forward + cross-profile check | WP13 | | T066 |
| T068 | Revert mechanism for failed repairs | WP13 | | T066 |
| T069 | Implement monitoring MCP tools (check_drift, get_trends, trigger_repair) | WP14 | | T032, T060, T066 |
| T070 | Langfuse integration hooks for metrics export | WP14 | [P] | T057 |
| T071 | Simulated drift scenarios (inject gradual vocabulary shift, verify detection) | WP14 | | T060 |
| T072 | Repair verification tests (apply repair, confirm regression passes) | WP14 | | T067 |
| T073 | Cross-profile regression tests (repair one profile, verify others unaffected) | WP14 | | T067 |

---

## Work Packages

### Setup & Foundation

#### WP01 — Package Foundation + Data Models
**Priority**: P0 (blocking everything)
**Dependencies**: None
**Subtasks**: T001-T007 (7 subtasks)
**Estimated prompt**: ~450 lines
**Prompt file**: [tasks/WP01-package-foundation.md](tasks/WP01-package-foundation.md)

Initialize the `joyus-profile-engine/` Python package with all Pydantic data models, domain templates, and test infrastructure. This WP produces the type foundation that all subsequent WPs build on.

- [x] T001: Initialize pyproject.toml with dependencies and dev tooling
- [x] T002: Define Pydantic models for corpus types
- [x] T003: Define Pydantic models for feature types
- [x] T004: Define Pydantic models for profile types
- [x] T005: Define Pydantic models for verification types
- [x] T006: Create domain template YAML schema and 4 templates
- [x] T007: Set up test infrastructure with conftest.py and fixtures

**Parallel**: T002-T005 can be developed in parallel (independent model files).
**Risk**: Pydantic model design locks in the data contract — changes cascade everywhere.

---

### Phase A: Profile Engine (Person-Level)

#### WP02 — Corpus Ingestion
**Priority**: P0
**Dependencies**: WP01
**Subtasks**: T008-T011 (4 subtasks)
**Estimated prompt**: ~350 lines
**Prompt file**: [tasks/WP02-corpus-ingestion.md](tasks/WP02-corpus-ingestion.md)

Build the document ingestion pipeline: load from multiple sources and formats, preprocess into normalized chunks ready for feature extraction.

- [x] T008: Implement CorpusLoader
- [x] T009: Implement format extractors (PDF, DOCX, HTML, MD, TXT)
- [x] T010: Implement Preprocessor
- [x] T011: Unit tests for ingestion pipeline

**Parallel**: Format extractors (T009) can be developed in parallel per format.
**Risk**: PDF extraction quality varies — PyMuPDF handles most cases but scanned PDFs need OCR (out of scope).

#### WP03 — Feature Extraction (129 Features)
**Priority**: P0
**Dependencies**: WP02
**Subtasks**: T012-T018 (7 subtasks)
**Estimated prompt**: ~500 lines
**Prompt file**: [tasks/WP03-feature-extraction.md](tasks/WP03-feature-extraction.md)

Implement all six analyzers that extract the 129-feature stylometric vector from processed corpora. The StylometricAnalyzer wraps faststylometry; others use spaCy and custom NLP.

- [x] T012: Implement StylometricAnalyzer (faststylometry wrapper)
- [x] T013: Implement custom feature extraction
- [x] T014: Implement MarkerAnalyzer
- [x] T015: Implement VocabularyAnalyzer
- [x] T016: Implement StructureAnalyzer
- [x] T017: Implement AudienceAnalyzer
- [x] T018: Regression tests for feature extraction

**Parallel**: T014-T017 are independent analyzers — all can be developed in parallel.
**Risk**: faststylometry Corpus not thread-safe; spaCy requires Python <=3.12.

#### WP04 — Profile Generation + Skill Emission
**Priority**: P0
**Dependencies**: WP03
**Subtasks**: T019-T025 (7 subtasks)
**Estimated prompt**: ~450 lines
**Prompt file**: [tasks/WP04-profile-generation.md](tasks/WP04-profile-generation.md)

Transform extracted features into structured 12-section AuthorProfiles and emit platform-consumable skill files (SKILL.md + markers.json + stylometrics.json).

- [x] T019: Implement ProfileGenerator.build()
- [x] T020: Domain-aware section weighting
- [x] T021: VoiceContext population (Layer 0)
- [x] T022: Confidence scoring
- [x] T023: Implement SkillEmitter.emit()
- [x] T024: Implement skill_md.py
- [x] T025: Implement validators.py

**Parallel**: T023-T025 (emission) can proceed once T019 interface is stable.
**Risk**: Profile section weighting needs empirical tuning — initial values are estimates.

#### WP05 — Two-Tier Verification + CLI
**Priority**: P0
**Dependencies**: WP04
**Subtasks**: T026-T031 (6 subtasks)
**Estimated prompt**: ~400 lines
**Prompt file**: [tasks/WP05-verification-cli.md](tasks/WP05-verification-cli.md)

Implement the two-tier verification system (Tier 1 inline <500ms, Tier 2 deep analysis) and CLI commands for building profiles and verifying content.

- [ ] T026: Implement CLI build command
- [ ] T027: Implement InlineChecker (Tier 1)
- [ ] T028: Implement DeepAnalyzer (Tier 2)
- [ ] T029: Implement FidelityScorer
- [ ] T030: Implement feedback.py
- [ ] T031: Implement CLI verify command

**Parallel**: T027 and T028 are independent verification tiers — can be developed in parallel.
**Risk**: Tier 1 latency target (<500ms) needs profiling; may require limiting to top-20 function words.

#### WP06 — MCP Server (Profile + Verify Tools)
**Priority**: P1
**Dependencies**: WP05
**Subtasks**: T032-T035 (4 subtasks)
**Estimated prompt**: ~350 lines
**Prompt file**: [tasks/WP06-mcp-server.md](tasks/WP06-mcp-server.md)

Expose the profile engine as MCP tools using the official Python `mcp` SDK. Implements build_profile, get_profile, compare_profiles, verify_content, and check_fidelity.

- [ ] T032: Implement MCP server entry point
- [ ] T033: Implement profile MCP tools
- [ ] T034: Implement verify MCP tools
- [ ] T035: Integration tests for MCP tools

**Parallel**: T033 and T034 are independent tool groups.
**Risk**: stdio transport requires all output on stderr; faststylometry calls need `asyncio.to_thread()`.

#### WP07 — Phase A Integration + Regression Testing
**Priority**: P1
**Dependencies**: WP06
**Subtasks**: T036-T038 (3 subtasks)
**Estimated prompt**: ~300 lines
**Prompt file**: [tasks/WP07-phase-a-testing.md](tasks/WP07-phase-a-testing.md)

Validate Phase A end-to-end: port PoC accuracy tests, run full corpus-to-verification pipeline, measure performance against targets.

- [ ] T036: Port PoC accuracy tests
- [ ] T037: End-to-end test: corpus → profile → skill files → verify
- [ ] T038: Performance tests

**Parallel**: T036 and T038 are independent test suites.
**Risk**: Accuracy regression requires real corpus samples; anonymized fixtures may give different results.

---

### Phase B: Hierarchical Profiles

#### WP08 — Composite Profile Builder
**Priority**: P1
**Dependencies**: WP04
**Subtasks**: T039-T042 (4 subtasks)
**Estimated prompt**: ~350 lines
**Prompt file**: [tasks/WP08-composite-builder.md](tasks/WP08-composite-builder.md)

Build department-level and org-level composite profiles from member profiles using corpus-size weighted mean aggregation.

- [ ] T039: Implement CompositeBuilder.build_department()
- [ ] T040: Implement CompositeBuilder.build_organization()
- [ ] T041: Define hierarchy Pydantic models
- [ ] T042: Topic-based department model

**Parallel**: WP08 can run in parallel with WP05-WP07 (Phase A completion).
**Risk**: Weighted mean algorithm needs real-world calibration.

#### WP09 — Hierarchy Management + Emission
**Priority**: P1
**Dependencies**: WP08
**Subtasks**: T043-T046 (4 subtasks)
**Estimated prompt**: ~350 lines
**Prompt file**: [tasks/WP09-hierarchy-management.md](tasks/WP09-hierarchy-management.md)

CRUD operations for the full profile hierarchy, cascade propagation, diffing, and multi-level skill file emission.

- [ ] T043: Implement HierarchyManager CRUD
- [ ] T044: Cascade org-level changes
- [ ] T045: Profile diffing
- [ ] T046: Skill file emission for full hierarchy

**Parallel**: T045 (diffing) is independent of T043-T044.

#### WP10 — Cascade Attribution
**Priority**: P1
**Dependencies**: WP09
**Subtasks**: T047-T050 (4 subtasks)
**Estimated prompt**: ~400 lines
**Prompt file**: [tasks/WP10-cascade-attribution.md](tasks/WP10-cascade-attribution.md)

Multi-level attribution engine: person → department → organization → outsider cascade with ranked candidate lists and MCP tool exposure.

- [ ] T047: Implement cascade attribution engine
- [ ] T048: Implement author identifier
- [ ] T049: Implement outsider detection
- [ ] T050: Attribution MCP tools

**Parallel**: T048 and T049 are independent attribution modes.

#### WP11 — Voice Context + Phase B Testing
**Priority**: P1
**Dependencies**: WP10
**Subtasks**: T051-T056 (6 subtasks)
**Estimated prompt**: ~450 lines
**Prompt file**: [tasks/WP11-voice-context-testing.md](tasks/WP11-voice-context-testing.md)

VoiceContext resolution (3-layer opt-in), access control, and comprehensive Phase B integration testing including hierarchy build and attribution accuracy.

- [ ] T051: Implement VoiceResolver.resolve()
- [ ] T052: Implement AccessChecker
- [ ] T053: Test Layer 0/1/2 voice behavior
- [ ] T054: Unit tests for composites, inheritance, cascade
- [ ] T055: Integration: full hierarchy + attribution cascade
- [ ] T056: Accuracy tests (dept >=90%, org >=85%, outsider >=95%)

**Parallel**: T051-T053 (voice) and T054 (unit tests) can proceed in parallel.

---

### Phase C: Fidelity Monitoring

#### WP12 — Monitoring Pipeline + Drift Detection
**Priority**: P2
**Dependencies**: WP07, WP11
**Subtasks**: T057-T062 (6 subtasks)
**Estimated prompt**: ~400 lines
**Prompt file**: [tasks/WP12-monitoring-drift.md](tasks/WP12-monitoring-drift.md)

Continuous monitoring pipeline with Tier 2 analysis queue, JSON-based score storage, trend aggregation, and five drift detection signals.

- [ ] T057: Implement monitoring pipeline
- [ ] T058: Score storage
- [ ] T059: Daily/weekly rollups
- [ ] T060: Implement five drift signals
- [ ] T061: Configurable thresholds per profile
- [ ] T062: Alert generation with severity

**Parallel**: T059 (rollups) and T060 (drift signals) can proceed once T058 is done.

#### WP13 — Drift Diagnosis + Repair Framework
**Priority**: P2
**Dependencies**: WP12
**Subtasks**: T063-T068 (6 subtasks)
**Estimated prompt**: ~400 lines
**Prompt file**: [tasks/WP13-diagnosis-repair.md](tasks/WP13-diagnosis-repair.md)

Diagnosis engine that identifies what drifted and why, plus repair action framework with 6 repair types, verification, and revert capability.

- [ ] T063: Implement diagnosis engine
- [ ] T064: Feature-level attribution
- [ ] T065: Human-readable diagnostic reports
- [ ] T066: Implement repair action framework
- [ ] T067: Repair verification
- [ ] T068: Revert mechanism

**Parallel**: T064-T065 (diagnosis detail) and T066 (repair framework) can proceed after T063.

#### WP14 — Monitoring MCP Tools + Testing
**Priority**: P2
**Dependencies**: WP13
**Subtasks**: T069-T073 (5 subtasks)
**Estimated prompt**: ~350 lines
**Prompt file**: [tasks/WP14-monitoring-mcp-testing.md](tasks/WP14-monitoring-mcp-testing.md)

Expose monitoring as MCP tools, integrate with Langfuse, and run simulated drift + repair verification scenarios.

- [ ] T069: Implement monitoring MCP tools
- [ ] T070: Langfuse integration hooks
- [ ] T071: Simulated drift scenarios
- [ ] T072: Repair verification tests
- [ ] T073: Cross-profile regression tests

**Parallel**: T070 (Langfuse) is independent of T069 (MCP tools).

---

## Dependency Graph

```
WP01 ─── WP02 ─── WP03 ─── WP04 ─┬── WP05 ─── WP06 ─── WP07 ──┐
                                   │                              │
                                   └── WP08 ─── WP09 ─── WP10 ── WP11 ──┐
                                                                         │
                                                              WP12 ──────┘
                                                                │
                                                              WP13
                                                                │
                                                              WP14
```

**Parallelization highlights**:
- After WP04: WP05 (verification) and WP08 (composites) can run in parallel
- Phase A completion (WP05→WP06→WP07) runs in parallel with Phase B (WP08→WP09→WP10→WP11)
- WP12 starts when BOTH Phase A (WP07) and Phase B (WP11) are complete

**MVP scope**: WP01-WP05 (person-level profiles with verification + CLI) — a usable profile engine without MCP or hierarchy.

### Phase Boundary: What's Deferred

The following spec sections are intentionally **not covered** in Phases A-C tasks:

| Spec Section | Why Deferred |
|-------------|-------------|
| §5 System 2: Writing Generation | Requires LLM integration (Phase D) |
| §7 Access Control / Content Provenance | SourceRef, GeneratedContent provenance needs generation pipeline (Phase D) |
| §9 Regulatory Change Detection | External API integrations — Federal Register, Congress.gov (Phase F) |
| §1.1 Self-Service Profile Building | Web interface, automatic tier detection (Phase E) |
| CompositeVoiceConfig (data-model.md) | Blended voice merging needs generation to validate (Phase D) |

These are tracked in `plan.md` § Deferred Scope. The monitoring infrastructure (Phase C) is designed to be generation-ready — WP12's pipeline accepts any text, not just System 2 output.

---

## Summary

| Phase | WPs | Subtasks | Priority |
|-------|-----|----------|----------|
| Foundation | WP01 | 7 | P0 |
| Phase A: Profile Engine | WP02-WP07 | 28 | P0-P1 |
| Phase B: Hierarchical Profiles | WP08-WP11 | 18 | P1 |
| Phase C: Fidelity Monitoring | WP12-WP14 | 20 | P2 |
| **Total** | **14** | **73** | |

Average subtasks per WP: **5.2** (range: 3-7)
Estimated prompt size: **300-500 lines** per WP (all within ideal range)
