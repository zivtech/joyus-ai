# Profile Engine API Contract

**Package**: `joyus-profile-engine`
**Language**: Python >=3.11
**Interface**: Library (importable) + CLI + MCP tools

---

## Library API (`joyus_profile`)

### Ingest

```python
from joyus_profile.ingest import CorpusLoader, Preprocessor

# Load documents from various sources
loader = CorpusLoader()
corpus = loader.load_directory(path: str, formats: list[str] = None) -> Corpus
corpus = loader.load_files(paths: list[str]) -> Corpus
corpus = loader.load_urls(urls: list[str]) -> Corpus
corpus = loader.load_text(text: str, metadata: dict = None) -> Corpus

# Preprocess corpus
preprocessor = Preprocessor()
processed = preprocessor.process(corpus: Corpus) -> ProcessedCorpus
#   - Normalize unicode, whitespace
#   - Clean boilerplate (headers, footers, navigation)
#   - Segment into chunks with metadata
#   - Returns ProcessedCorpus with chunk boundaries and stats
```

### Analyze

```python
from joyus_profile.analyze import (
    StylometricAnalyzer,
    MarkerAnalyzer,
    VocabularyAnalyzer,
    StructureAnalyzer,
    AudienceAnalyzer,
)

# Full 129-feature extraction
stylo = StylometricAnalyzer()
features = stylo.extract(corpus: ProcessedCorpus) -> StylometricFeatures
#   Returns: function_words, sentence_length, vocabulary_richness,
#            punctuation, character_ngrams, pos_ngrams, etc.

# Content marker identification
markers = MarkerAnalyzer()
marker_set = markers.extract(corpus: ProcessedCorpus, domain: str = "general") -> MarkerSet
#   Returns: high_signal, medium_signal, negative_markers with weights

# Vocabulary analysis
vocab = VocabularyAnalyzer()
vocab_profile = vocab.extract(corpus: ProcessedCorpus) -> VocabularyProfile
#   Returns: signature_phrases, preferred_terms, avoided_terms, technical_terms

# Structural pattern analysis
structure = StructureAnalyzer()
patterns = structure.extract(corpus: ProcessedCorpus) -> StructuralPatterns

# Audience/register detection
audience = AudienceAnalyzer()
registers = audience.extract(corpus: ProcessedCorpus) -> AudienceProfile
```

### Profile

```python
from joyus_profile.profile import ProfileGenerator

# Build person-level profile
generator = ProfileGenerator(domain: str = "general")
profile = generator.build(
    corpus: ProcessedCorpus,
    author_name: str,
    template: str = None,       # Path to domain template YAML (auto-detected if None)
) -> AuthorProfile

# Build with explicit features (if pre-extracted)
profile = generator.build_from_features(
    features: StylometricFeatures,
    markers: MarkerSet,
    vocabulary: VocabularyProfile,
    structure: StructuralPatterns,
    audience: AudienceProfile,
    author_name: str,
    domain: str = "general",
) -> AuthorProfile
```

### Composite (Phase B)

```python
from joyus_profile.profile import CompositeBuilder, HierarchyManager

# Build department profile from members
builder = CompositeBuilder()
dept_profile = builder.build_department(
    member_profiles: list[AuthorProfile],
    department_name: str,
    domain_specialization: str,
) -> DepartmentProfile

# Build org profile from departments
org_profile = builder.build_organization(
    department_profiles: list[DepartmentProfile],
    org_name: str,
    editorial_style_guide: StyleGuide = None,
    official_positions: list[OfficialPosition] = None,
    prohibited_framings: list[ProhibitedFraming] = None,
    voice_definitions: dict[str, VoiceDefinition] = None,
) -> OrganizationProfile

# Manage full hierarchy
hierarchy = HierarchyManager()
h = hierarchy.build(
    people: list[AuthorProfile],
    departments_config: dict,     # {dept_id: {name, members, domain}}
    org_config: dict,             # {name, style_guide, positions, prohibitions, voices}
) -> ProfileHierarchy

h = hierarchy.add_person(hierarchy: ProfileHierarchy, profile: AuthorProfile, dept_ids: list[str]) -> ProfileHierarchy
h = hierarchy.remove_person(hierarchy: ProfileHierarchy, person_id: str) -> ProfileHierarchy
h = hierarchy.rebuild_composites(hierarchy: ProfileHierarchy) -> ProfileHierarchy
diff = hierarchy.diff(old: ProfileHierarchy, new: ProfileHierarchy) -> HierarchyDiff
```

### Emit

```python
from joyus_profile.emit import SkillEmitter

emitter = SkillEmitter()

# Emit skill files for a single profile
emitter.emit(
    profile: AuthorProfile,
    output_dir: str,
) -> SkillFileSet
#   Creates: output_dir/SKILL.md, output_dir/markers.json, output_dir/stylometrics.json
#   If profile has voice_contexts: also output_dir/voices/{audience_key}.json

# Emit skill files for full hierarchy
emitter.emit_hierarchy(
    hierarchy: ProfileHierarchy,
    output_dir: str,
) -> dict[str, SkillFileSet]
#   Creates: output_dir/org/*, output_dir/departments/*/, output_dir/people/*/

# Validate emitted files
emitter.validate(output_dir: str) -> ValidationResult
```

### Verify

```python
from joyus_profile.verify import InlineChecker, DeepAnalyzer, FidelityScorer

# Tier 1: Inline verification (<500ms)
checker = InlineChecker()
result = checker.check(
    text: str,
    profile: AuthorProfile,
    voice_key: str = None,     # Specific audience voice (None = base)
) -> InlineResult
#   Returns: score (0.0-1.0), passed (bool), feedback (str), details

# Tier 2: Deep analysis (async)
analyzer = DeepAnalyzer()
result = analyzer.analyze(
    text: str,
    profile: AuthorProfile,
    history: list[str] = None,  # Recent outputs for consistency check
) -> DeepResult
#   Returns: burrows_delta, feature_breakdown, drift_detected, recommendations

# Unified scoring
scorer = FidelityScorer()
score = scorer.score(
    text: str,
    profile: AuthorProfile,
    tier: Literal[1, 2, "both"] = "both",
) -> FidelityScore
```

### Attribute (Phase B)

```python
from joyus_profile.attribute import AttributionEngine

engine = AttributionEngine(hierarchy: ProfileHierarchy)

# Verify text against known author
result = engine.verify_author(text: str, person_id: str) -> AttributionResult

# Identify unknown author (cascade: person → dept → org → outsider)
result = engine.identify(text: str) -> AttributionResult

# Validate against department
result = engine.validate_department(text: str, dept_id: str) -> AttributionResult

# Validate against organization
result = engine.validate_organization(text: str) -> AttributionResult

# Detect outsider
result = engine.detect_outsider(text: str) -> AttributionResult
```

### Monitor (Phase C)

```python
from joyus_profile.monitor import DriftDetector, DriftDiagnoser, RepairManager

# Drift detection
detector = DriftDetector(data_dir: str)
detector.record_score(profile_id: str, score: FidelityScore) -> None
signals = detector.check(profile_id: str) -> list[DriftSignal]
trends = detector.get_trends(profile_id: str, window_days: int = 14) -> TrendReport

# Drift diagnosis
diagnoser = DriftDiagnoser()
diagnosis = diagnoser.diagnose(signals: list[DriftSignal], profile: AuthorProfile) -> DriftDiagnosis

# Repair management
repair_mgr = RepairManager(hierarchy: ProfileHierarchy)
action = repair_mgr.propose(diagnosis: DriftDiagnosis) -> RepairAction
result = repair_mgr.apply(action: RepairAction) -> RepairVerification
repair_mgr.revert(action: RepairAction) -> None
```

### Voice Resolution

```python
from joyus_profile.voice import VoiceResolver, AccessChecker

# Resolve voice at generation time
resolver = VoiceResolver()
resolved = resolver.resolve(
    profile: AuthorProfile,
    audience_key: str = None,   # None = base profile (Layer 0)
    hierarchy: ProfileHierarchy = None,  # For org-level merging
) -> ResolvedProfile
#   Returns: merged profile with voice overrides applied,
#            vocabulary merged from all levels,
#            prohibited framings enforced

# Check access
checker = AccessChecker()
allowed = checker.can_access_voice(
    profile: AuthorProfile,
    voice_key: str,
    user_access_level: ContentAccessLevel,
) -> bool
```

---

## CLI API

```bash
# Build a person-level profile
joyus-profile build \
    --corpus ./docs/ \
    --author "Author Name" \
    --domain legal_advocacy \
    --output ./skills/author-001/

# Build a full hierarchy
joyus-profile build-hierarchy \
    --profiles ./skills/people/ \
    --departments departments.yaml \
    --org org.yaml \
    --output ./skills/

# Verify content against a profile
joyus-profile verify \
    --text ./output.md \
    --profile ./skills/author-001/ \
    --tier both \
    --voice advocate

# Compare two profiles
joyus-profile compare \
    --profile-a ./skills/author-001/ \
    --profile-b ./skills/author-002/

# Check drift for a profile
joyus-profile check-drift \
    --profile ./skills/author-001/ \
    --data-dir ./monitoring/
```

---

## Error Handling

All library methods raise typed exceptions:

| Exception | When |
|-----------|------|
| `CorpusError` | Corpus loading/parsing failure |
| `InsufficientCorpusError` | Below minimum document count (<5) |
| `ProfileBuildError` | Feature extraction or profile generation failure |
| `ValidationError` | Pydantic validation failure on any model |
| `EmissionError` | Skill file write failure |
| `AttributionError` | Cascade attribution failure |
| `DriftDetectionError` | Monitoring data access failure |
| `AccessDeniedError` | Voice access level violation |

All exceptions include `details: dict` with diagnostic information.

---

## Return Types

All operations return Pydantic models (serializable to JSON). No raw dicts.

Success responses include:
- `status: str` — "success" | "warning" | "partial"
- `warnings: list[str]` — Non-fatal issues (e.g., "corpus below optimal size")
- `metadata: dict` — Timing, corpus stats, feature counts
