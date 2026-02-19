# Joyus AI Profile Engine — Specification

**Phase:** 2.5 (Priority — standalone library)
**Date:** February 17, 2026
**Status:** Specification
**Depends on:** Nothing (independent of platform infrastructure)
**Consumed by:** Phase 3 (Platform Framework), Phase 4 (Attribution Service)

---

## 1. Purpose

A standalone Python library that:
1. **Builds writing profiles** from a document corpus (any domain)
2. **Emits skill files** consumable by the Joyus AI platform
3. **Verifies content fidelity** via two-tier checking (inline + async)

This is the platform's moat — domain knowledge that models can't generate on their own and that doesn't get subsumed by model upgrades (Decision #18).

---

## 2. Architecture

```
joyus-profile-engine/
├── pyproject.toml                    (package config, dependencies)
├── README.md
│
├── joyus_profile/                    (importable library)
│   ├── __init__.py
│   │
│   ├── ingest/                       (WS1: corpus ingestion)
│   │   ├── __init__.py
│   │   ├── loader.py                 ← Load docs from files, URLs, or raw text
│   │   ├── preprocessor.py           ← Normalize, clean, segment into chunks
│   │   └── formats.py                ← PDF, DOCX, HTML, plain text extractors
│   │
│   ├── analyze/                      (WS1: feature extraction)
│   │   ├── __init__.py
│   │   ├── stylometrics.py           ← 129-feature extraction (from NCLC engine)
│   │   ├── markers.py                ← Domain-specific term/phrase identification
│   │   ├── vocabulary.py             ← Preferred/avoided terms, signature phrases
│   │   ├── structure.py              ← Document org, paragraph patterns, sentence stats
│   │   └── audience.py               ← Register detection (formal/informal, audience type)
│   │
│   ├── profile/                      (WS1: profile generation)
│   │   ├── __init__.py
│   │   ├── generator.py              ← Features → structured profile (12-section template)
│   │   ├── schema.py                 ← Profile data model (Pydantic)
│   │   └── templates/                ← Domain-specific section weight configs
│   │       ├── legal_advocacy.yaml   ← NCLC-derived (proven)
│   │       ├── technical.yaml        ← Software/engineering writing
│   │       ├── marketing.yaml        ← Brand/marketing voice
│   │       └── general.yaml          ← Fallback for unknown domains
│   │
│   ├── emit/                         (WS2: skill file output)
│   │   ├── __init__.py
│   │   ├── skill_emitter.py          ← Profile → SKILL.md + markers.json + stylometrics.json
│   │   ├── skill_md.py               ← Generate SKILL.md from profile sections
│   │   └── validators.py             ← Validate emitted skill files against schema
│   │
│   ├── verify/                       (WS3: content fidelity)
│   │   ├── __init__.py
│   │   ├── inline_checker.py         ← Tier 1: marker presence + stylometric distance (~100ms)
│   │   ├── deep_analyzer.py          ← Tier 2: full Burrows' Delta + cross-doc consistency
│   │   ├── scorer.py                 ← Unified fidelity score (0.0-1.0) with breakdown
│   │   └── feedback.py               ← Generate human-readable mismatch feedback for model
│   │
│   └── models/                       (shared data models)
│       ├── __init__.py
│       ├── corpus.py                 ← Document, Chunk, Corpus types
│       ├── features.py               ← StylometricFeatures, MarkerSet, VocabularyProfile
│       ├── profile.py                ← AuthorProfile, ProfileSection types
│       └── verification.py           ← FidelityScore, Mismatch, VerificationResult
│
├── cli/                              (command-line tools)
│   ├── build_profile.py              ← corpus path → profile → skill files
│   ├── verify_content.py             ← text + profile → fidelity score + feedback
│   └── compare_profiles.py           ← profile A vs B → similarity analysis
│
├── tests/
│   ├── conftest.py                   ← Shared fixtures (NCLC corpus samples)
│   ├── test_ingest/
│   ├── test_analyze/
│   ├── test_profile/
│   ├── test_emit/
│   ├── test_verify/
│   ├── regression/
│   │   └── test_nclc_accuracy.py     ← NCLC accuracy must not regress below baseline
│   └── integration/
│       └── test_end_to_end.py        ← Full pipeline: corpus → profile → verify
│
└── fixtures/                         (test data)
    ├── nclc/                         ← Anonymized NCLC samples for regression
    └── zivtech/                      ← Zivtech internal writing for second-domain validation
```

---

## 3. Profile Schema

The profile data model standardizes what the platform consumes. Based on the NCLC 12-section template, adapted for multi-domain use.

```python
class AuthorProfile(BaseModel):
    """Complete author writing profile — output of the profile generator."""

    # Metadata
    profile_id: str                          # Unique identifier
    author_name: str                         # Display name
    domain: str                              # legal_advocacy | technical | marketing | general
    corpus_size: int                         # Number of documents analyzed
    created_at: datetime
    updated_at: datetime
    confidence: float                        # 0.0-1.0 overall profile confidence

    # Section 1: Identity
    identity: AuthorIdentity                 # Background, role, expertise areas

    # Section 2: Expertise domains
    expertise: ExpertiseDomains              # Primary/secondary specializations, boundaries

    # Section 3: Positions (domain-dependent)
    positions: list[Position]                # Stance declarations with strength + evidence

    # Section 4: Voice & Tone
    voice: VoiceProfile
    #   formality: float                     # 1-10 scale
    #   emotion: float                       # analytical ↔ passionate
    #   directness: float                    # hedged ↔ assertive
    #   complexity: float                    # accessible ↔ technical
    #   audience_registers: dict[str, RegisterShift]  # Layer 0 — simple register shifts

    # Voice Contexts (Layer 1-2: multi-audience voices)
    voice_contexts: dict[str, VoiceContext]   # audience_key → full voice context
    #   Empty dict = Layer 0 (single voice, backwards-compatible)
    #   Populated = Layer 1+ (multi-audience or restricted voices)

    # Section 5: Structural patterns
    structure: StructuralPatterns
    #   document_patterns: list[DocumentPattern]
    #   paragraph_avg_length: int
    #   sentence_avg_length: float
    #   opening_patterns: list[AnnotatedExample]
    #   closing_patterns: list[AnnotatedExample]

    # Section 6: Language inventory
    vocabulary: VocabularyProfile
    #   signature_phrases: list[SignaturePhrase]    # 50+ with frequency/context
    #   preferred_terms: list[TermMapping]          # 100+ standard → preferred
    #   avoided_terms: list[AvoidedTerm]            # 50+ with reason + alternative
    #   technical_terminology: list[str]

    # Section 7: Argumentation patterns
    argumentation: ArgumentationProfile
    #   evidence_hierarchy: list[str]               # What evidence they prioritize
    #   logical_structures: list[AnnotatedExample]
    #   rebuttal_patterns: list[AnnotatedExample]

    # Section 8: Citation patterns
    citations: CitationProfile
    #   preferred_sources: list[SourcePreference]
    #   citation_style: str
    #   self_citation_pattern: str

    # Section 9: Anti-patterns
    anti_patterns: AntiPatterns
    #   never_do: list[AntiPattern]                 # With explanation
    #   common_ai_mistakes: list[MistakeCorrection]
    #   voice_drift_indicators: list[str]

    # Section 10: Example outputs
    examples: ExampleOutputs
    #   good_examples: list[AnnotatedExample]       # 5-10 with annotations
    #   bad_examples: list[MistakeCorrection]       # Bad → corrected

    # Section 11: Edge cases
    edge_cases: list[EdgeCase]                      # Scenario + guidance

    # Section 12: Validation criteria
    validation: ValidationCriteria
    #   self_check_questions: list[str]
    #   required_markers_per_document: int
    #   minimum_fidelity_score: float
```

### 3.1 VoiceContext Architecture (Added Feb 19, 2026)

The `RegisterShift` model (simple parameter deltas on voice/tone) is insufficient for organizations whose authors write in fundamentally different voices for different audiences. NCLC attorneys, for example, write as Litigator (courts), Advocate (legislators), Educator (public), Expert (treatises), and Consumer Advocate "Priest" (teaching lawyers) — these differ across vocabulary, argumentation, citations, structure, and positions, not just tone.

**Three-layer opt-in design:**

| Layer | Who needs it | What it adds | Backwards impact |
|-------|-------------|-------------|-----------------|
| **Layer 0** | All clients | Single AuthorProfile, one voice. `voice_contexts` is empty dict. | None — existing behavior unchanged |
| **Layer 1** | Multi-audience orgs | `VoiceContext` objects override specific profile sections per audience | Additive — base profile still works for default voice |
| **Layer 2** | Restricted voice orgs | `VoiceAccessLevel` on VoiceContext. Voice profiles are access-gated assets | Additive — requires auth integration |

```python
class VoiceContext(BaseModel):
    """A complete voice configuration for a specific audience.

    Overrides specific sections of the base AuthorProfile when this
    voice is active. Sections not overridden inherit from the base profile.
    """

    voice_id: str                                # Unique identifier
    audience_key: str                            # e.g., "litigator", "advocate", "educator"
    audience_label: str                          # Human-readable: "Litigator (Courts)"
    description: str                             # When to use this voice

    # Fidelity tier for THIS voice (may differ from base profile)
    fidelity_tier: Literal[1, 2, 3, 4]          # Per-voice, not per-author
    corpus_size_for_voice: int                   # Words analyzed for this specific voice

    # Section overrides — only populated sections replace the base profile
    voice_override: Optional[VoiceProfile]       # §4 — tone, formality, etc.
    vocabulary_override: Optional[VocabularyProfile]  # §6 — different terms per audience
    argumentation_override: Optional[ArgumentationProfile]  # §7
    citations_override: Optional[CitationProfile]      # §8
    structure_override: Optional[StructuralPatterns]    # §5
    positions_override: Optional[list[Position]]        # §3 — may hold different positions per audience
    examples_override: Optional[ExampleOutputs]         # §10 — audience-specific examples
    anti_patterns_override: Optional[AntiPatterns]      # §9 — audience-specific anti-patterns

    # Layer 2: Access control (optional — empty for Layer 1)
    access_level: Optional[VoiceAccessLevel]     # None = unrestricted (Layer 1)

class VoiceAccessLevel(BaseModel):
    """Access control for a voice profile itself (Layer 2).

    The voice profile — not just the content it produces — is an access-gated asset.
    Statistical patterns (markers, stylometrics) remain unrestricted.
    Positions, analytical frameworks, and example outputs inherit this access level.
    """

    level: ContentAccessLevel                    # PUBLIC | SUBSCRIBER | GROUP | INTERNAL
    restricted_sections: list[str]               # Which override sections are gated
    #   e.g., ["positions_override", "examples_override"] — patterns stay open

class CompositeVoiceConfig(BaseModel):
    """Configuration for composite voices that blend multiple source voices.

    Example: NCLC's "Priest" voice blends Litigator + Advocate + Educator + Expert
    voices plus restricted strategic "secrets" corpus.
    """

    source_voices: list[str]                     # voice_ids to blend
    source_weights: dict[str, float]             # voice_id → weight (sum to 1.0)
    additional_corpus_ref: Optional[str]         # Reference to restricted corpus
    blending_strategy: Literal["weighted_merge", "section_specific", "conditional"]
    #   weighted_merge: blend all sources proportionally
    #   section_specific: take §4 from voice A, §7 from voice B, etc.
    #   conditional: switch source voice based on content topic
```

**Per-voice fidelity:** An author may be Tier 4 for Expert voice (50K+ words of treatise writing) but Tier 2 for Advocate voice (5K words of congressional testimony). The `fidelity_tier` field lives on `VoiceContext`, not on `AuthorProfile`, enabling honest representation of what's achievable per audience.

**Resolution at generation time:**
1. Request specifies target author + audience (e.g., "Write as Lauren Saunders, Advocate voice")
2. Load base `AuthorProfile` for Lauren Saunders
3. Look up `voice_contexts["advocate"]`
4. For each profile section: use override if present, otherwise inherit from base
5. Apply merged profile to generation
6. Fidelity check uses the voice-specific fidelity tier and corpus

### Required vs. Optional by Domain

| Section | Legal Advocacy | Technical | Marketing | General |
|---------|---------------|-----------|-----------|---------|
| Identity | Required | Required | Required | Required |
| Expertise | Required | Required | Optional | Optional |
| Positions | **Required** (core) | Optional | Optional | Optional |
| Voice & Tone | Required | Required | **Required** (core) | Required |
| Structure | Required | Required | Required | Required |
| Vocabulary | Required | Required | **Required** (core) | Required |
| Argumentation | **Required** (core) | Optional | Optional | Optional |
| Citations | **Required** (core) | Required | Optional | Optional |
| Anti-patterns | Required | Required | Required | Required |
| Examples | Required | Required | Required | Required |
| Edge cases | Optional | Optional | Optional | Optional |
| Validation | Required | Required | Required | Required |

---

## 4. Skill File Output Format

The emitter produces three files per author profile:

### SKILL.md
Human-readable and Claude-readable instructions. Generated from profile sections.

```markdown
# Writing Profile: [Author Name]

## Voice
Formality: 7/10 (professional but accessible)
Tone: Analytical with measured passion on [topic areas]
...

## Vocabulary
### Signature Phrases (use frequently)
- "rent-a-bank scheme" — when discussing bank/fintech partnerships
- ...

### Preferred Terms
| Instead of | Use |
|-----------|-----|
| high-cost loan | predatory loan (when APR >36%) |
| ...

### Never Use
| Term | Why | Alternative |
|------|-----|-------------|
| "innovation" (unqualified) | Industry framing | "so-called innovation" |
| ...

## Structure
[Document patterns, paragraph conventions...]

## Anti-Patterns
[Common mistakes, voice drift indicators...]

## Examples
### Good
[Annotated examples...]

### Bad → Corrected
[Before/after pairs...]

## Validation Checklist
Before delivering content in this voice:
- [ ] Contains at least N signature phrases
- [ ] Fidelity score >= 0.X
- [ ] No terms from "Never Use" list
```

### markers.json
Machine-readable content markers for fast Tier 1 verification.

```json
{
  "profile_id": "author-abc123",
  "domain": "legal_advocacy",
  "markers": {
    "high_signal": [
      {"term": "rent-a-bank scheme", "weight": 0.95, "context": "bank/fintech partnerships"},
      {"term": "Regulation F", "weight": 0.90, "context": "FDCPA debt collection"}
    ],
    "medium_signal": [
      {"term": "predatory lending", "weight": 0.60, "context": "high-cost credit"},
      {"term": "so-called", "weight": 0.55, "context": "skeptical framing"}
    ],
    "negative_markers": [
      {"term": "innovation", "weight": -0.80, "context": "unqualified positive use"},
      {"term": "consumer choice", "weight": -0.70, "context": "industry framing"}
    ]
  },
  "thresholds": {
    "tier1_pass": 0.70,
    "tier1_flag": 0.50,
    "tier1_fail": 0.30
  }
}
```

### stylometrics.json
Baseline feature distributions for Tier 2 deep analysis.

```json
{
  "profile_id": "author-abc123",
  "feature_count": 129,
  "corpus_size": 22,
  "features": {
    "function_words": {
      "the": 0.065,
      "of": 0.042,
      "and": 0.038,
      "...": "..."
    },
    "sentence_length": {
      "mean": 24.3,
      "std": 8.7,
      "median": 22.0
    },
    "vocabulary_richness": {
      "type_token_ratio": 0.43,
      "hapax_legomena_ratio": 0.12
    },
    "punctuation": {
      "comma_rate": 0.034,
      "semicolon_rate": 0.002,
      "em_dash_rate": 0.001
    }
  },
  "burrows_delta_baseline": {
    "self_distance_mean": 0.82,
    "self_distance_std": 0.11,
    "mismatch_threshold": 1.5
  }
}
```

---

## 5. Two-Tier Verification

### Tier 1: Inline Verification (per-generation quality gate)

**When:** Called by the orchestrator after every content generation, before delivery.
**Latency budget:** <500ms per check (target: ~100ms)
**Purpose:** Catch obvious voice drift so the model can self-correct.

```python
def inline_check(text: str, profile: AuthorProfile) -> InlineResult:
    """
    Fast verification: marker presence + basic stylometric distance.

    Returns:
        InlineResult:
            score: float (0.0-1.0)
            passed: bool (score >= threshold)
            feedback: str (human-readable, for feeding back to model)
            details: MarkerCheckResult + StyleCheckResult
    """

    # Check 1: Content marker presence (~10ms)
    marker_score = check_markers(text, profile.markers)
    #   - Count high_signal markers present
    #   - Count negative_markers present (penalty)
    #   - Weighted score

    # Check 2: Basic stylometric distance (~50ms)
    style_score = quick_style_check(text, profile.stylometrics)
    #   - Sentence length distribution similarity
    #   - Function word frequency distance (top 20 only — fast)
    #   - Vocabulary richness comparison

    # Combined score
    score = (marker_score * 0.6) + (style_score * 0.4)

    # Generate feedback for model if failed
    if score < threshold:
        feedback = generate_inline_feedback(text, profile, marker_score, style_score)
        # e.g. "Score 0.52/1.0. Missing signature phrases: 'rent-a-bank',
        #        'predatory lending'. Detected negative marker: 'innovation'
        #        used positively in paragraph 3. Sentence length averaging
        #        32 words (target: 24). Regenerate with closer attention
        #        to vocabulary list."

    return InlineResult(score=score, passed=score >= threshold, feedback=feedback)
```

### Tier 2: Deep Analysis (async monitoring)

**When:** Post-delivery, queued for background processing.
**Latency:** Seconds to minutes (not user-blocking).
**Purpose:** Track quality over time, detect drift, feed corrections back into skill updates.

```python
def deep_analyze(text: str, profile: AuthorProfile, history: list[str] = None) -> DeepResult:
    """
    Full stylometric analysis + cross-document consistency.

    Returns:
        DeepResult:
            burrows_delta: float (distance from profile baseline)
            feature_breakdown: dict[str, float] (per-feature distances)
            drift_detected: bool
            drift_details: list[DriftSignal]
            recommendations: list[SkillUpdateRecommendation]
    """

    # Analysis 1: Full Burrows' Delta (129 features)
    delta = compute_burrows_delta(text, profile.stylometrics)

    # Analysis 2: Feature-by-feature breakdown
    breakdown = feature_distance_breakdown(text, profile.stylometrics)
    #   Identifies which specific features are drifting

    # Analysis 3: Cross-document consistency (if history provided)
    if history:
        consistency = cross_document_analysis(text, history, profile)
        #   - Is this document consistent with recent outputs?
        #   - Detect gradual voice drift across sessions

    # Analysis 4: Skill update recommendations
    if delta > profile.burrows_delta_baseline.mismatch_threshold:
        recommendations = generate_update_recommendations(breakdown, profile)
        #   - "Vocabulary section: add 'emerging term X' to preferred list"
        #   - "Anti-patterns: 'phrase Y' appearing frequently, add to avoided list"

    return DeepResult(...)
```

### Feedback Loop: Tier 2 → Skill Updates

```
Generation → Tier 1 check → Deliver → Tier 2 analysis
                                            │
                                            ▼
                                    Correction Queue
                                            │
                                    ┌───────┴───────┐
                                    │  Accumulate    │
                                    │  corrections   │
                                    │  over N docs   │
                                    └───────┬───────┘
                                            │
                                            ▼
                                    ┌───────────────┐
                                    │  Generate      │
                                    │  skill update  │
                                    │  PR            │
                                    └───────┬───────┘
                                            │
                                            ▼
                                    Human review + approve
                                            │
                                            ▼
                                    Updated SKILL.md + markers.json
```

---

## 6. Corpus Requirements

### Minimum Corpus Size

| Confidence Level | Documents | Approximate Words |
|-----------------|-----------|-------------------|
| **High** (Tier 1 author) | 10+ documents | 30,000+ words |
| **Medium** (Tier 2 author) | 7-9 documents | 20,000+ words |
| **Minimum viable** | 5 documents | 10,000+ words |
| **Below threshold** | <5 documents | Warn user, generate partial profile |

Based on NCLC experience: 7-9 documents per author was the minimum for reliable profiles. Authors with 20+ documents achieved highest accuracy.

### Supported Input Formats

| Format | Extractor | Notes |
|--------|-----------|-------|
| Plain text (.txt) | Direct | Cleanest input |
| Markdown (.md) | Strip formatting | Preserve structure info |
| PDF | PyMuPDF / pdfplumber | OCR fallback for scanned docs |
| DOCX | python-docx | Preserve heading structure |
| HTML | BeautifulSoup | Strip navigation, extract article body |
| URL | requests + trafilatura | Web page content extraction |

---

## 7. Workstream Breakdown

### WS1: Extract & Generalize (Week 1)

**Goal:** Pull NCLC attribution code into a clean, domain-agnostic library.

| Task | Source | Output |
|------|--------|--------|
| Extract stylometric engine | `nclc/tiered_attribution_model.py` | `analyze/stylometrics.py` |
| Extract marker system | `nclc/tiered_attribution_model.py` | `analyze/markers.py` |
| Build corpus loader | New (adapt from `nclc/extract_author_content.py`) | `ingest/loader.py` + `formats.py` |
| Build preprocessor | New | `ingest/preprocessor.py` |
| Extract vocabulary analysis | `nclc/build_thematic_profiles.py` | `analyze/vocabulary.py` |
| Build profile generator | New (based on COMPREHENSIVE_PROFILE_TEMPLATE.md) | `profile/generator.py` |
| Define Pydantic models | New | `models/*.py` |
| Domain config templates | New | `profile/templates/*.yaml` |
| NCLC regression tests | Adapt `nclc/validate_tier1_profiles.py` | `tests/regression/test_nclc_accuracy.py` |

**Acceptance criteria:**
- `joyus_profile.analyze.stylometrics` produces identical features to NCLC engine
- `joyus_profile.analyze.markers` identifies NCLC author markers correctly
- NCLC regression test passes (accuracy >= 94.6% on 4-author set)

### WS2: Skill File Emitter (Week 1-2, overlaps WS1)

**Goal:** Profile → platform-consumable skill files.

| Task | Output |
|------|--------|
| SKILL.md generator | `emit/skill_md.py` |
| markers.json emitter | `emit/skill_emitter.py` |
| stylometrics.json emitter | `emit/skill_emitter.py` |
| Schema validation | `emit/validators.py` |
| CLI: `build_profile` | `cli/build_profile.py` |

**Acceptance criteria:**
- Given an NCLC author corpus, produces valid SKILL.md + markers.json + stylometrics.json
- Emitted skill files match the structure defined in §4
- CLI runs end-to-end: `build-profile --corpus ./docs/ --domain legal_advocacy --output ./skills/author-a/`

### WS3: Two-Tier Verification (Week 2-3)

**Goal:** Content fidelity checking as both inline gate and async analysis.

| Task | Output |
|------|--------|
| Tier 1 inline checker | `verify/inline_checker.py` |
| Tier 2 deep analyzer | `verify/deep_analyzer.py` |
| Unified scoring | `verify/scorer.py` |
| Feedback generator (for model) | `verify/feedback.py` |
| CLI: `verify_content` | `cli/verify_content.py` |
| Integration test | `tests/integration/test_end_to_end.py` |

**Acceptance criteria:**
- Tier 1: <500ms for a 1000-word document
- Tier 1: correctly flags text written in wrong author's voice (>90% detection)
- Tier 2: Burrows' Delta within expected range for known-author text
- Feedback generator produces actionable, specific guidance
- CLI: `verify-content --text ./output.md --profile ./skills/author-a/ --tier both`

### Validation: Second Domain (Week 3)

**Goal:** Prove the engine works beyond NCLC.

- Build a Zivtech internal writing profile from existing content (proposals, blog posts, documentation)
- Run verification against known Zivtech-authored text
- Document what worked, what needed domain-specific tuning

---

## 8. Dependencies

| Dependency | Purpose | Version |
|-----------|---------|---------|
| Python | Runtime | >=3.11 |
| pydantic | Data models, validation | >=2.0 |
| numpy | Stylometric computation | >=1.24 |
| scipy | Statistical distance functions (Burrows' Delta) | >=1.11 |
| scikit-learn | Feature extraction, TF-IDF | >=1.3 |
| PyMuPDF (fitz) | PDF text extraction | >=1.23 |
| python-docx | DOCX text extraction | >=1.1 |
| beautifulsoup4 | HTML parsing | >=4.12 |
| trafilatura | Web page content extraction | >=1.6 |
| pyyaml | Domain config templates | >=6.0 |
| click | CLI framework | >=8.1 |
| pytest | Testing | >=7.4 |

---

## 9. Open Questions

| Question | Context | Priority |
|----------|---------|----------|
| Profile schema field weights per domain — what makes a legal profile different from a marketing profile? | NCLC template is legal-heavy (positions, argumentation, citations). Marketing profiles need heavier voice/vocabulary/brand. Need empirical tuning. | High — Week 1 |
| Minimum corpus size validation — is 5 docs really the floor? | NCLC used 7-9 minimum. Need to test with smaller corpora to find actual degradation curve. | Medium — Week 2 |
| Claude-assisted profile generation — should Claude help fill in profile sections? | Pure statistical analysis misses nuance. Hybrid approach: extract features statistically, have Claude synthesize into natural language sections. Risk: profile quality depends on prompt quality. | High — Week 1 |
| Tier 1 threshold calibration — what score should trigger regeneration? | NCLC used content markers as primary discriminator. Threshold likely varies by domain and author distinctiveness. Need calibration data. | Medium — Week 2-3 |
| Package distribution — pip install or git submodule? | If Phase 3 platform imports this, how? PyPI private package, git submodule, or monorepo subfolder? | Low — Week 3 |
| Profile versioning — how to handle profile updates without breaking existing skill files? | Profiles will evolve as authors evolve. Need semantic versioning for profiles and a way to diff profile versions. | Medium — Phase 3 |

---

## 10. Success Criteria

| Metric | Target |
|--------|--------|
| NCLC regression accuracy (4-author set) | >= 94.6% |
| NCLC regression accuracy (9-author set) | >= 97.9% |
| Tier 1 verification latency | < 500ms per 1000-word doc |
| Tier 1 wrong-voice detection rate | > 90% |
| Skill file generation (end-to-end) | < 5 minutes per author corpus |
| Second-domain validation | Zivtech profile builds successfully, Tier 1 detects voice mismatch |
| Test coverage | > 80% |

---

*Spec created: February 17, 2026*
*For: Joyus AI Platform — Phase 2.5*
*References: NCLC author-identification-research, Boris Cherny verification loop insight (Decision #17)*
