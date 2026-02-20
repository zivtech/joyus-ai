# Data Model: Content Intelligence (Phases A-C)

**Feature**: 005-content-intelligence
**Date**: 2026-02-19

---

## Core Entities

### AuthorProfile

The foundational entity. A complete writing profile for one person, built from corpus analysis.

| Field | Type | Description |
|-------|------|-------------|
| `profile_id` | str | Unique identifier (CUID2) |
| `author_name` | str | Display name |
| `domain` | str | `legal_advocacy` \| `technical` \| `marketing` \| `general` |
| `corpus_size` | int | Number of documents analyzed |
| `word_count` | int | Total words in corpus |
| `fidelity_tier` | int (1-4) | Achievable fidelity tier based on corpus |
| `created_at` | datetime | Profile creation timestamp |
| `updated_at` | datetime | Last update timestamp |
| `confidence` | float (0.0-1.0) | Overall profile confidence |
| `version` | str | Semver for profile schema |
| `department_ids` | list[str] | Topic-based expertise areas this person belongs to |
| `identity` | AuthorIdentity | Background, role, expertise areas |
| `expertise` | ExpertiseDomains | Primary/secondary specializations |
| `positions` | list[Position] | Stance declarations with strength + evidence |
| `voice` | VoiceProfile | Formality, emotion, directness, complexity |
| `voice_contexts` | dict[str, VoiceContext] | Per-audience voice overrides (empty = Layer 0) |
| `structure` | StructuralPatterns | Document/paragraph/sentence patterns |
| `vocabulary` | VocabularyProfile | Signature phrases, preferred/avoided terms |
| `argumentation` | ArgumentationProfile | Evidence hierarchy, logical structures |
| `citations` | CitationProfile | Preferred sources, citation style |
| `anti_patterns` | AntiPatterns | Never-do list, common AI mistakes |
| `examples` | ExampleOutputs | Good/bad annotated examples |
| `edge_cases` | list[EdgeCase] | Scenario + guidance |
| `validation` | ValidationCriteria | Self-check questions, minimum scores |

### VoiceContext

Per-audience voice configuration. Overrides specific AuthorProfile sections when active.

| Field | Type | Description |
|-------|------|-------------|
| `voice_id` | str | Unique identifier |
| `audience_key` | str | e.g., "litigator", "advocate", "educator" |
| `audience_label` | str | Human-readable: "Formal (Courts)" |
| `description` | str | When to use this voice |
| `fidelity_tier` | int (1-4) | Per-voice fidelity (may differ from base) |
| `corpus_size_for_voice` | int | Words analyzed for this voice |
| `voice_override` | VoiceProfile \| null | §4 overrides |
| `vocabulary_override` | VocabularyProfile \| null | §6 overrides |
| `argumentation_override` | ArgumentationProfile \| null | §7 overrides |
| `citations_override` | CitationProfile \| null | §8 overrides |
| `structure_override` | StructuralPatterns \| null | §5 overrides |
| `positions_override` | list[Position] \| null | §3 overrides |
| `examples_override` | ExampleOutputs \| null | §10 overrides |
| `anti_patterns_override` | AntiPatterns \| null | §9 overrides |
| `access_level` | VoiceAccessLevel \| null | Layer 2 access control (null = unrestricted) |

### VoiceAccessLevel

Access control for a voice profile (Layer 2).

| Field | Type | Description |
|-------|------|-------------|
| `level` | ContentAccessLevel | PUBLIC \| SUBSCRIBER \| GROUP \| INTERNAL |
| `restricted_sections` | list[str] | Which override sections are gated |

### CompositeVoiceConfig

Configuration for blended voices (e.g., composite blended voice).

| Field | Type | Description |
|-------|------|-------------|
| `source_voices` | list[str] | voice_ids to blend |
| `source_weights` | dict[str, float] | voice_id → weight (sum to 1.0) |
| `additional_corpus_ref` | str \| null | Reference to restricted corpus |
| `blending_strategy` | str | `weighted_merge` \| `section_specific` \| `conditional` |

---

## Feature Catalog (129 Features)

The stylometric feature vector extracted by the 6 analyzers in WP03. Features are grouped by analyzer source.

### StylometricAnalyzer (faststylometry — ~50 features)

| # | Feature | Description |
|---|---------|-------------|
| 1-50 | Top-50 MFW frequencies | Most frequent word relative frequencies (Burrows' Delta basis) |

### Custom Feature Extraction (~30 features)

| # | Feature | Description |
|---|---------|-------------|
| 51-70 | Top-20 function word ratios | Closed-class word frequencies (the, of, and, to, a, in, ...) |
| 71-75 | Sentence length stats | mean, median, std, min, max |
| 76-80 | Punctuation density | comma_rate, semicolon_rate, colon_rate, dash_rate, exclamation_rate |
| 81-90 | Character trigram frequencies | Top-10 discriminative character n-grams |
| 91-95 | Vocabulary richness | type_token_ratio, hapax_legomena_ratio, yule_k, simpson_d, brunet_w |

### MarkerAnalyzer (~10 features)

| # | Feature | Description |
|---|---------|-------------|
| 96-100 | Domain marker density | high_signal_count, medium_signal_count, marker_diversity, marker_consistency, negative_marker_count |
| 101-105 | Signature phrase metrics | phrase_count, phrase_uniqueness, phrase_frequency_mean, phrase_frequency_std, phrase_coverage |

### VocabularyAnalyzer (~10 features)

| # | Feature | Description |
|---|---------|-------------|
| 106-110 | Term preference | preferred_term_ratio, avoided_term_ratio, technical_density, jargon_ratio, formality_score |
| 111-115 | Lexical patterns | avg_word_length, long_word_ratio, rare_word_ratio, latin_root_ratio, compound_term_ratio |

### StructureAnalyzer (~10 features)

| # | Feature | Description |
|---|---------|-------------|
| 116-120 | Paragraph patterns | avg_paragraph_length, paragraph_length_std, list_usage_rate, heading_depth, section_count |
| 121-125 | Syntactic patterns | avg_parse_depth, subordinate_clause_ratio, passive_voice_ratio, question_ratio, quotation_density |

### AudienceAnalyzer (~4 features)

| # | Feature | Description |
|---|---------|-------------|
| 126-129 | Register indicators | formality_index, hedging_ratio, directness_score, audience_specificity |

**Note**: Exact feature count may vary during implementation. The "129" target is approximate — WP03 implementers should document the final feature set and update this catalog. Features 1-50 come from faststylometry's MFW analysis; features 51-129 are custom-extracted via spaCy and NLP.

---

## Hierarchy Entities (Phase B)

### DepartmentProfile

Topic-based expertise area composite, built from member profiles.

| Field | Type | Description |
|-------|------|-------------|
| `department_id` | str | Unique identifier |
| `name` | str | "Credit Reporting", "Banking & Payments", etc. |
| `domain_specialization` | str | Primary domain |
| `member_ids` | list[str] | Person profile_ids in this department |
| `shared_vocabulary` | VocabularyProfile | Terms common across members (intersection) |
| `shared_positions` | list[Position] | Department-level stances |
| `structural_range` | StructuralPatterns | Union of member patterns |
| `audience_registers` | dict[str, RegisterInfo] | Merged from members |
| `typical_document_types` | list[str] | Common output types |
| `stylometric_baseline` | StylometricBaseline | Aggregated feature distributions |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### OrganizationProfile

Top-level organizational composite, extends AuthorProfile.

| Field | Type | Description |
|-------|------|-------------|
| `org_id` | str | Unique identifier |
| `name` | str | Organization name |
| `editorial_style_guide` | StyleGuide | Official style rules |
| `official_positions` | list[OfficialPosition] | Org-level stances (may override individual) |
| `prohibited_framings` | list[ProhibitedFraming] | Terms/framings never used |
| `department_overrides` | dict[str, OverrideSet] | Dept-specific org rules |
| `voice_definitions` | dict[str, VoiceDefinition] | Audience voice catalog |
| `stylometric_baseline` | StylometricBaseline | Org-wide feature distributions |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### ProfileHierarchy

Complete organizational profile hierarchy.

| Field | Type | Description |
|-------|------|-------------|
| `hierarchy_id` | str | Unique identifier |
| `org_profile` | OrganizationProfile | Top level |
| `departments` | dict[str, DepartmentProfile] | dept_id → profile |
| `people` | dict[str, AuthorProfile] | person_id → profile |
| `department_members` | dict[str, list[str]] | dept_id → [person_ids] |
| `person_departments` | dict[str, list[str]] | person_id → [dept_ids] |
| `version` | str | Hierarchy schema version |
| `built_at` | datetime | Last full rebuild |

### VoiceDefinition

Org-level voice declaration (audience voices available to all authors).

| Field | Type | Description |
|-------|------|-------------|
| `audience_key` | str | e.g., "litigator", "advocate" |
| `audience_label` | str | Human-readable label |
| `description` | str | When and how this voice is used |
| `target_audience` | str | Who is being addressed |
| `access_level` | ContentAccessLevel \| null | null = unrestricted |

---

## Attribution Entities (Phase B)

### AttributionResult

Result of running attribution against the hierarchy.

| Field | Type | Description |
|-------|------|-------------|
| `result_id` | str | Unique identifier |
| `text_hash` | str | SHA256 of input text (first 16 chars) |
| `mode` | str | `verify_known` \| `identify` \| `validate_dept` \| `validate_org` \| `detect_outsider` |
| `match_level` | str \| null | `person` \| `department` \| `organization` \| `outsider` \| null |
| `target_id` | str \| null | Specified target (if verify mode) |
| `candidates` | list[CandidateMatch] | Ranked matches |
| `confidence` | float (0.0-1.0) | Overall confidence |
| `explanation_tier` | str | `pattern` \| `passage` |
| `explanation` | str | Human-readable explanation |
| `timestamp` | datetime | |

### CandidateMatch

A single candidate in the attribution ranking.

| Field | Type | Description |
|-------|------|-------------|
| `profile_id` | str | Matched profile |
| `profile_type` | str | `person` \| `department` \| `organization` |
| `score` | float (0.0-1.0) | Attribution confidence |
| `feature_breakdown` | dict[str, float] | Per-feature contribution |
| `matched_markers` | list[str] | Which markers were found |

---

## Verification Entities

### FidelityScore

Unified fidelity assessment for generated content.

| Field | Type | Description |
|-------|------|-------------|
| `score` | float (0.0-1.0) | Combined score |
| `passed` | bool | score >= threshold |
| `tier` | int (1 or 2) | Which verification tier |
| `marker_score` | float | Content marker component |
| `style_score` | float | Stylometric distance component |
| `feature_breakdown` | dict[str, float] | Per-feature distances (Tier 2 only) |
| `feedback` | str \| null | Actionable feedback if failed |
| `timestamp` | datetime | |

### VerificationResult

Complete verification output (may include both tiers).

| Field | Type | Description |
|-------|------|-------------|
| `result_id` | str | Unique identifier |
| `profile_id` | str | Target profile |
| `voice_key` | str \| null | Specific voice (if multi-audience) |
| `tier1` | FidelityScore \| null | Inline check result |
| `tier2` | FidelityScore \| null | Deep analysis result (async) |
| `source_provenance` | list[SourceRef] | What influenced the content |
| `access_level` | ContentAccessLevel | Inherited from highest source |

---

## Monitoring Entities (Phase C)

### DriftSignal

A detected quality drift for a specific profile.

| Field | Type | Description |
|-------|------|-------------|
| `signal_id` | str | Unique identifier |
| `profile_id` | str | Affected profile |
| `signal_type` | str | `fidelity_decline` \| `marker_shift` \| `stylometric_distance` \| `negative_increase` \| `inconsistency` |
| `severity` | str | `low` \| `medium` \| `high` \| `critical` |
| `current_value` | float | Current measurement |
| `baseline_value` | float | Expected measurement |
| `deviation` | float | How far from baseline |
| `window_start` | datetime | Measurement window start |
| `window_end` | datetime | Measurement window end |
| `sample_count` | int | Documents in window |

### DriftDiagnosis

Diagnosis of detected drift.

| Field | Type | Description |
|-------|------|-------------|
| `diagnosis_id` | str | Unique identifier |
| `profile_id` | str | Affected profile |
| `detection_date` | datetime | When drift was detected |
| `severity` | str | `low` \| `medium` \| `high` \| `critical` |
| `signals` | list[DriftSignal] | Contributing signals |
| `affected_features` | list[DriftedFeature] | What specifically drifted |
| `probable_cause` | str | `model_update` \| `corpus_evolution` \| `position_change` \| `vocabulary_shift` \| `profile_staleness` \| `unknown` |
| `recommended_action` | RepairAction | What to do about it |
| `diagnosed_at` | datetime | |

### DriftedFeature

A single feature that has drifted.

| Field | Type | Description |
|-------|------|-------------|
| `feature_name` | str | e.g., "vocabulary.signature_phrases" |
| `description` | str | Human-readable: "usage dropped 35%" |
| `baseline_value` | float | Expected |
| `current_value` | float | Observed |
| `deviation_pct` | float | Percentage deviation |

### RepairAction

A proposed repair for detected drift.

| Field | Type | Description |
|-------|------|-------------|
| `action_id` | str | Unique identifier |
| `action_type` | str | `rebuild_profile` \| `update_markers` \| `recalibrate_thresholds` \| `update_positions` \| `update_corpus` \| `escalate` |
| `description` | str | What this repair does |
| `automated` | bool | Can be applied without human approval |
| `status` | str | `proposed` \| `approved` \| `applied` \| `verified` \| `reverted` \| `rejected` |
| `proposed_at` | datetime | |
| `applied_at` | datetime \| null | |
| `verified_at` | datetime \| null | |
| `verification_result` | RepairVerification \| null | Post-repair check |

### RepairVerification

Verification after a repair is applied.

| Field | Type | Description |
|-------|------|-------------|
| `regression_passed` | bool | Accuracy didn't drop below baseline |
| `forward_passed` | bool | New content meets fidelity threshold |
| `cross_profile_passed` | bool | Other profiles unaffected |
| `details` | str | Explanation |

---

## Access Control Entities

### ContentAccessLevel (enum)

```
PUBLIC | SUBSCRIBER | GROUP | INTERNAL
```

### SourceRef

Provenance tracking for generated content.

| Field | Type | Description |
|-------|------|-------------|
| `source_id` | str | Document identifier |
| `source_type` | str | `book` \| `article` \| `blog` \| `memo` \| `testimony` |
| `access_level` | ContentAccessLevel | Source's access level |
| `influence_type` | str | `direct_reference` \| `style_source` \| `position_source` |
| `section_ref` | str \| null | Specific section referenced |

### GeneratedContent

Metadata for content produced by System 2.

| Field | Type | Description |
|-------|------|-------------|
| `content_id` | str | Unique identifier |
| `text` | str | Generated content |
| `target_profile` | str | Who it was written as |
| `target_voice` | str \| null | Specific audience voice |
| `fidelity_score` | float | System 1 validation score |
| `source_provenance` | list[SourceRef] | What influenced this output |
| `access_level` | ContentAccessLevel | Inherited from highest source |
| `access_justification` | str | Why this level was assigned |
| `generated_at` | datetime | |

---

## Relationships

```
ProfileHierarchy 1──1 OrganizationProfile
ProfileHierarchy 1──* DepartmentProfile
ProfileHierarchy 1──* AuthorProfile

OrganizationProfile 1──* VoiceDefinition      (org declares available voices)
OrganizationProfile 1──* OfficialPosition      (may override individual)
OrganizationProfile 1──* ProhibitedFraming     (cascades to all levels)

DepartmentProfile *──* AuthorProfile           (topic-based, many-to-many)

AuthorProfile 1──* VoiceContext                (per-audience voice overrides)
VoiceContext  0──1 VoiceAccessLevel            (Layer 2 access gating)

GeneratedContent 1──1 VerificationResult
GeneratedContent 1──* SourceRef                (provenance tracking)

DriftSignal *──1 AuthorProfile                 (drift detected for a profile)
DriftDiagnosis 1──* DriftSignal                (diagnosis aggregates signals)
DriftDiagnosis 1──1 RepairAction               (recommended fix)
RepairAction 0──1 RepairVerification           (post-repair check)
```

---

## State Transitions

### Profile Lifecycle

```
[Corpus provided] → ingest() → analyze(129 features) → generate(profile)
    → emit(SKILL.md + markers.json + stylometrics.json) → validate()
                                                              ↓
                                                    [Profile active]
                                                              ↓
                                                    [Drift detected]
                                                              ↓
                                                    diagnose() → propose_repair()
                                                              ↓
                                                    [Human approves]
                                                              ↓
                                                    apply_repair() → verify_repair()
                                                              ↓
                                                    [Profile updated] or [Repair reverted]
```

### Attribution Cascade

```
[Text input] → check_persons(all profiles)
    → high confidence (>0.85)? → return person match
    → no? → check_departments(all dept profiles)
        → high confidence (>0.80)? → return department match
        → no? → check_org(org profile)
            → match (>0.70)? → return org match
            → no? → flag as outsider
```

### Verification Flow

```
[Generated content] → tier1_check(<500ms)
    → passed? → deliver + queue tier2
    → failed? → feedback → regenerate (loop max 3x)
                                    ↓
                            [Tier 2 async]
                                    ↓
                            deep_analyze() → store_score() → check_trends()
                                    ↓
                            [Drift signal?] → add_to_monitoring()
```

---

## Validation Rules

- `AuthorProfile.confidence` must be >= 0.5 for profile to be usable
- `AuthorProfile.corpus_size` must be >= 5 documents (warn below, partial profile)
- `VoiceContext.fidelity_tier` must match available corpus: Tier 1 needs 300+ words, Tier 2 needs 2K+, Tier 3 needs 10K+, Tier 4 needs 50K+
- `DepartmentProfile.member_ids` must have >= 2 members
- `OrganizationProfile.prohibited_framings` cascade to all departments and people (cannot be overridden)
- `OfficialPosition` marked `authoritative: true` overrides individual positions
- `GeneratedContent.access_level` must be >= max(source_provenance[].access_level)
- `RepairAction` cannot be applied without verification if `automated: false`
- `DriftSignal.severity == "critical"` requires immediate notification
