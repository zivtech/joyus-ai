---
work_package_id: "WP01"
title: "Package Foundation + Data Models"
lane: "done"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"]
agent: "claude"
shell_pid: "54869"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
  - date: "2026-02-19"
    action: "created"
    by: "spec-kitty.tasks"
---

# WP01: Package Foundation + Data Models

## Objective

Initialize the `joyus-profile-engine/` Python package with all Pydantic data models, domain templates, and test infrastructure. This WP produces the type foundation that every subsequent work package builds on.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Context

- **Spec**: `kitty-specs/005-content-intelligence/spec.md`
- **Plan**: `kitty-specs/005-content-intelligence/plan.md` (§A.1)
- **Data Model**: `kitty-specs/005-content-intelligence/data-model.md`
- **API Contract**: `kitty-specs/005-content-intelligence/contracts/profile-engine-api.md`

The profile engine is a standalone Python package at the repository root, alongside `joyus-ai-mcp-server/` and `joyus-ai-state/`. All data types use Pydantic v2 models with strict validation.

---

## Subtask T001: Initialize pyproject.toml with Dependencies

**Purpose**: Create the Python package skeleton with all production and dev dependencies.

**Steps**:
1. Create `joyus-profile-engine/` at repository root
2. Create `pyproject.toml` with:
   - `name = "joyus-profile-engine"`
   - `requires-python = ">=3.11"`
   - Production deps: `pydantic>=2.0`, `numpy`, `scipy`, `scikit-learn`, `pandas`, `spacy>=3.6`, `faststylometry>=1.0.15`, `pymupdf`, `python-docx`, `beautifulsoup4`, `trafilatura`, `mcp>=1.20`, `click`, `pyyaml`, `cuid2`
   - Dev deps: `pytest`, `pytest-cov`, `pytest-asyncio`, `ruff`, `mypy`, `types-pyyaml`
   - Entry points: `joyus-profile = "joyus_profile.cli:main"` (click CLI)
   - Ruff config: line-length 100, target Python 3.11
3. Create `joyus_profile/__init__.py` with `__version__ = "0.1.0"`
4. Create empty module directories per plan.md §Project Structure:
   - `joyus_profile/ingest/`, `analyze/`, `profile/`, `emit/`, `verify/`, `attribute/`, `monitor/`, `voice/`, `models/`
   - `cli/`, `mcp_server/`, `mcp_server/tools/`
   - Each with `__init__.py`

**Files**:
- `joyus-profile-engine/pyproject.toml` (new, ~60 lines)
- `joyus-profile-engine/joyus_profile/__init__.py` (new)
- 12+ `__init__.py` files for subpackages

**Validation**:
- [ ] `pip install -e ".[dev]"` succeeds
- [ ] `python -c "import joyus_profile"` succeeds
- [ ] `ruff check .` passes (no files to check yet, but config valid)

---

## Subtask T002: Corpus Data Models

**Purpose**: Define Pydantic models for corpus ingestion types.

**Steps**:
1. Create `joyus_profile/models/corpus.py`
2. Define models (reference: data-model.md §Core Entities + contracts/profile-engine-api.md §Ingest):

```python
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum

class DocumentFormat(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    HTML = "html"
    MARKDOWN = "md"
    TEXT = "txt"

class DocumentMetadata(BaseModel):
    source_path: str | None = None
    source_url: str | None = None
    author: str | None = None
    title: str | None = None
    format: DocumentFormat = DocumentFormat.TEXT
    word_count: int = 0
    created_at: datetime | None = None

class Document(BaseModel):
    doc_id: str  # CUID2
    text: str
    metadata: DocumentMetadata

class Chunk(BaseModel):
    chunk_id: str
    doc_id: str
    text: str
    start_offset: int
    end_offset: int
    word_count: int

class Corpus(BaseModel):
    documents: list[Document] = Field(default_factory=list)
    total_words: int = 0
    total_documents: int = 0

class ProcessedCorpus(BaseModel):
    corpus: Corpus
    chunks: list[Chunk] = Field(default_factory=list)
    total_chunks: int = 0
    avg_chunk_words: float = 0.0
```

3. Export from `models/__init__.py`

**Files**:
- `joyus_profile/models/corpus.py` (new, ~60 lines)
- `joyus_profile/models/__init__.py` (updated)

**Validation**:
- [ ] Models instantiate with valid data
- [ ] Models reject invalid data (Pydantic validation)
- [ ] JSON serialization/deserialization round-trips correctly

---

## Subtask T003: Feature Data Models

**Purpose**: Define Pydantic models for extracted stylometric features.

**Steps**:
1. Create `joyus_profile/models/features.py`
2. Define models (reference: data-model.md + profile-engine-api.md §Analyze):

```python
class StylometricFeatures(BaseModel):
    """Full 129-feature extraction result."""
    function_word_frequencies: dict[str, float] = Field(default_factory=dict)  # top-129
    sentence_length_stats: SentenceLengthStats
    vocabulary_richness: VocabularyRichness
    punctuation_ratios: dict[str, float] = Field(default_factory=dict)
    character_ngrams: dict[str, float] = Field(default_factory=dict)
    pos_ngrams: dict[str, float] = Field(default_factory=dict)
    burrows_delta_baseline: float | None = None  # self-distance
    feature_count: int = 0

class SentenceLengthStats(BaseModel):
    mean: float = 0.0
    median: float = 0.0
    std: float = 0.0
    min: int = 0
    max: int = 0
    distribution: list[int] = Field(default_factory=list)  # histogram bins

class VocabularyRichness(BaseModel):
    type_token_ratio: float = 0.0
    hapax_legomena_ratio: float = 0.0
    yules_k: float = 0.0
    simpsons_diversity: float = 0.0

class MarkerSet(BaseModel):
    high_signal: list[Marker] = Field(default_factory=list)
    medium_signal: list[Marker] = Field(default_factory=list)
    negative_markers: list[Marker] = Field(default_factory=list)

class Marker(BaseModel):
    text: str
    weight: float = Field(ge=0.0, le=1.0)
    frequency: float = 0.0
    domain: str = "general"

class VocabularyProfile(BaseModel):
    signature_phrases: list[str] = Field(default_factory=list)
    preferred_terms: list[str] = Field(default_factory=list)
    avoided_terms: list[str] = Field(default_factory=list)
    technical_terms: list[str] = Field(default_factory=list)

class StructuralPatterns(BaseModel):
    avg_paragraph_length: float = 0.0
    avg_paragraphs_per_doc: float = 0.0
    heading_frequency: float = 0.0
    list_usage_ratio: float = 0.0
    citation_density: float = 0.0

class AudienceProfile(BaseModel):
    primary_register: str = "neutral"  # formal/informal/technical/conversational
    formality_score: float = Field(default=5.0, ge=0.0, le=10.0)
    detected_audiences: list[str] = Field(default_factory=list)
```

3. Export from `models/__init__.py`

**Files**:
- `joyus_profile/models/features.py` (new, ~100 lines)

**Validation**:
- [ ] All feature models serialize to JSON
- [ ] Field constraints enforced (ge/le bounds)

---

## Subtask T004: Profile Data Models

**Purpose**: Define the core AuthorProfile, VoiceContext, and related profile models.

**Steps**:
1. Create `joyus_profile/models/profile.py`
2. Define models (reference: data-model.md §AuthorProfile, §VoiceContext, §VoiceAccessLevel, §CompositeVoiceConfig):

Key models to implement:
- `AuthorProfile`: 28 fields including identity, expertise, positions, voice, voice_contexts, structure, vocabulary, argumentation, citations, anti_patterns, examples, edge_cases, validation criteria
- `VoiceContext`: Per-audience voice configuration with section overrides (voice_override, vocabulary_override, argumentation_override, citations_override, structure_override, positions_override, examples_override, anti_patterns_override) and optional access_level
- `VoiceAccessLevel`: level (ContentAccessLevel enum) + restricted_sections list
- `CompositeVoiceConfig`: source_voices, source_weights, blending_strategy
- `ContentAccessLevel`: PUBLIC | SUBSCRIBER | GROUP | INTERNAL enum
- Supporting types: `Position`, `AuthorIdentity`, `ExpertiseDomains`, `VoiceProfile`, `ArgumentationProfile`, `CitationProfile`, `AntiPatterns`, `ExampleOutputs`, `EdgeCase`, `ValidationCriteria`

3. Use CUID2 for all IDs (via `cuid2` package)
4. All timestamps as `datetime`
5. All scores as `float` with `Field(ge=0.0, le=1.0)` constraints
6. Export from `models/__init__.py`

**Files**:
- `joyus_profile/models/profile.py` (new, ~250 lines)

**Validation**:
- [ ] AuthorProfile with all 28 fields validates
- [ ] VoiceContext section overrides are Optional (null = no override)
- [ ] ContentAccessLevel enum serializes as string
- [ ] JSON round-trip preserves all fields

---

## Subtask T005: Verification Data Models

**Purpose**: Define models for fidelity scores, verification results, attribution, and monitoring.

**Steps**:
1. Create `joyus_profile/models/verification.py` with:
   - `FidelityScore`: score, passed, tier, marker_score, style_score, feature_breakdown, feedback
   - `VerificationResult`: result_id, profile_id, voice_key, tier1, tier2, source_provenance, access_level
   - `InlineResult`: score, passed, feedback, details, latency_ms
   - `DeepResult`: burrows_delta, feature_breakdown, drift_detected, recommendations

2. Create `joyus_profile/models/attribution.py` with:
   - `AttributionResult`: result_id, text_hash, mode, match_level, candidates, confidence, explanation
   - `CandidateMatch`: profile_id, profile_type, score, feature_breakdown, matched_markers

3. Create `joyus_profile/models/monitoring.py` with:
   - `DriftSignal`: signal_id, profile_id, signal_type, severity, current_value, baseline_value, deviation, window
   - `DriftDiagnosis`: diagnosis_id, signals, affected_features, probable_cause, recommended_action
   - `DriftedFeature`: feature_name, description, baseline_value, current_value, deviation_pct
   - `RepairAction`: action_id, action_type, description, automated, status
   - `RepairVerification`: regression_passed, forward_passed, cross_profile_passed, details

4. Create `joyus_profile/models/content.py` with:
   - `SourceRef`: source_id, source_type, access_level, influence_type, section_ref
   - `GeneratedContent`: content_id, text, target_profile, fidelity_score, source_provenance, access_level

**Files**:
- `joyus_profile/models/verification.py` (new, ~80 lines)
- `joyus_profile/models/attribution.py` (new, ~60 lines)
- `joyus_profile/models/monitoring.py` (new, ~100 lines)
- `joyus_profile/models/content.py` (new, ~40 lines)

**Validation**:
- [ ] All models serialize/deserialize correctly
- [ ] Enum fields validated (signal_type, severity, probable_cause, etc.)

---

## Subtask T006: Domain Template YAML Schema + 4 Templates

**Purpose**: Create YAML templates that define domain-specific profile section weighting and terminology.

**Steps**:
1. Create `joyus_profile/profile/templates/` directory
2. Define template schema (Pydantic model in `profile/schema.py` or inline):
   ```yaml
   domain: legal_advocacy
   display_name: "Legal Advocacy"
   section_weights:
     positions: 0.9      # Heavy weight on legal stances
     argumentation: 0.9   # Legal reasoning patterns
     citations: 0.8       # Case law, statute references
     vocabulary: 0.7
     voice: 0.6
     structure: 0.5
   terminology:
     domain_terms: ["regulation", "statute", "compliance", "enforcement"]
     register_hints: ["formal", "technical", "advocacy"]
   ```
3. Create 4 templates:
   - `legal_advocacy.yaml`: Heavy on positions, argumentation, citations
   - `technical.yaml`: Heavy on structure, vocabulary, terminology
   - `marketing.yaml`: Heavy on voice, audience, vocabulary
   - `general.yaml`: Balanced weights (default)

**Files**:
- `joyus_profile/profile/templates/legal_advocacy.yaml` (new)
- `joyus_profile/profile/templates/technical.yaml` (new)
- `joyus_profile/profile/templates/marketing.yaml` (new)
- `joyus_profile/profile/templates/general.yaml` (new)

**Validation**:
- [ ] Each template loads and validates against schema
- [ ] All section_weights sum is reasonable (not enforced, but documented)

---

## Subtask T007: Test Infrastructure + Fixtures

**Purpose**: Set up pytest configuration, shared fixtures, and sample documents for testing.

**Steps**:
1. Create `tests/conftest.py` with shared fixtures:
   - `sample_corpus()`: 5-10 short text documents (anonymized, ~200 words each)
   - `processed_corpus()`: Pre-processed version of sample_corpus
   - `sample_profile()`: A minimal valid AuthorProfile
   - `tmp_output_dir()`: Temporary directory for skill file output
2. Create `tests/unit/` and `tests/integration/` and `tests/regression/` directories
3. Create `fixtures/example/` with 5+ anonymized sample documents (plain text)
4. Create `fixtures/internal/` directory (empty, for real validation data later)
5. Add `pytest.ini` or `[tool.pytest.ini_options]` in pyproject.toml:
   - `testpaths = ["tests"]`
   - `asyncio_mode = "auto"`

**Files**:
- `tests/conftest.py` (new, ~80 lines)
- `tests/unit/__init__.py`, `tests/integration/__init__.py`, `tests/regression/__init__.py`
- `fixtures/example/doc_01.txt` through `doc_05.txt` (new, sample texts)

**Validation**:
- [ ] `pytest --collect-only` discovers test infrastructure
- [ ] Fixtures load without errors
- [ ] Sample documents are realistic but anonymized

---

## Definition of Done

- [ ] `pip install -e ".[dev]"` succeeds from `joyus-profile-engine/`
- [ ] All Pydantic models import and validate correctly
- [ ] `python -c "from joyus_profile.models import AuthorProfile, VoiceContext, FidelityScore"` works
- [ ] Domain templates load from YAML
- [ ] Test fixtures provide sample data for all subsequent WPs
- [ ] `ruff check joyus_profile/` passes
- [ ] `mypy joyus_profile/models/` passes (strict mode)

## Risks

- **Pydantic model design is foundational**: Changes to AuthorProfile cascade to every WP. Review the data-model.md carefully before implementing.
- **CUID2 dependency**: If `cuid2` package has compatibility issues, fall back to `uuid4` with `str(uuid4())[:24]` prefix.
- **spaCy install size**: The full package with `en_core_web_md` is ~200MB. Ensure test CI can handle this.

## Activity Log

- 2026-02-19T23:50:19Z – claude – shell_pid=54869 – lane=doing – Started implementation via workflow command
- 2026-02-20T02:56:36Z – claude – shell_pid=54869 – lane=for_review – Complete: 7 model modules, 4 domain templates, 5 fixtures, 45 passing tests, pip installable via uv
- 2026-02-20T03:17:57Z – claude – shell_pid=54869 – lane=done – Review complete: all findings addressed, 45 tests passing, sanitization verified
