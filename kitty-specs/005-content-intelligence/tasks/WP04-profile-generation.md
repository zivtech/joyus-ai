---
work_package_id: WP04
title: Profile Generation + Skill Emission
lane: planned
dependencies: [WP03]
subtasks: [T019, T020, T021, T022, T023, T024, T025]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP04: Profile Generation + Skill Emission

## Objective

Transform extracted features into structured 12-section AuthorProfiles and emit platform-consumable skill files (SKILL.md + markers.json + stylometrics.json).

## Implementation Command

```bash
spec-kitty implement WP04 --base WP03
```

## Context

- **Plan**: plan.md §A.4, §A.5
- **Spec**: spec.md §5.2 (Profile Building Pipeline), §5.6 (Fidelity Tiers)
- **API Contract**: contracts/profile-engine-api.md §Profile, §Emit
- **Data Model**: data-model.md §AuthorProfile

---

## Subtask T019: ProfileGenerator.build()

**Purpose**: Convert extracted features into a structured 12-section AuthorProfile.

**Steps**:
1. Create `joyus_profile/profile/generator.py`
2. Implement `ProfileGenerator`:
   ```python
   class ProfileGenerator:
       def __init__(self, domain: str = "general"):
           self.domain = domain
           self.template = self._load_template(domain)

       def build(self, corpus: ProcessedCorpus, author_name: str,
                 template: str | None = None) -> AuthorProfile:
           # 1. Run all analyzers on the corpus
           stylo = StylometricAnalyzer().extract(corpus)
           markers = MarkerAnalyzer().extract(corpus, self.domain)
           vocab = VocabularyAnalyzer().extract(corpus)
           structure = StructureAnalyzer().extract(corpus)
           audience = AudienceAnalyzer().extract(corpus)

           # 2. Determine fidelity tier from corpus size
           tier = self._determine_tier(corpus.corpus.total_words)

           # 3. Build AuthorProfile sections with domain weighting
           profile = AuthorProfile(
               profile_id=cuid2(),
               author_name=author_name,
               domain=self.domain,
               corpus_size=corpus.corpus.total_documents,
               word_count=corpus.corpus.total_words,
               fidelity_tier=tier,
               # ... populate all 12 sections
           )
           return profile

       def build_from_features(self, ...) -> AuthorProfile:
           # Accepts pre-extracted features (for when analyzers ran separately)
   ```
3. The 12 sections map to analyzer outputs:
   - §1 identity → from metadata
   - §2 expertise → from domain + vocabulary analysis
   - §3 positions → from marker analysis (stance indicators)
   - §4 voice → from audience analysis (formality, tone)
   - §5 structure → from structure analysis
   - §6 vocabulary → from vocabulary analysis
   - §7 argumentation → from structure + markers (evidence patterns)
   - §8 citations → from structure (citation density + patterns)
   - §9 anti_patterns → derived from negative markers
   - §10 examples → selected corpus excerpts (reference only, not verbatim)
   - §11 edge_cases → from domain template
   - §12 validation → thresholds based on fidelity tier

**Files**:
- `joyus_profile/profile/generator.py` (new, ~200 lines)

**Validation**:
- [ ] `build()` returns a complete AuthorProfile with all sections populated
- [ ] `build_from_features()` produces identical results given same features
- [ ] Fidelity tier correctly assigned based on word count thresholds

---

## Subtask T020: Domain-Aware Section Weighting

**Purpose**: Weight profile sections differently based on domain (legal heavy on positions, marketing heavy on voice).

**Steps**:
1. Load domain template YAML (from WP01 T006) in ProfileGenerator
2. Apply section weights during profile building:
   - Higher-weighted sections get more detailed extraction
   - Lower-weighted sections get basic extraction
   - Example: legal_advocacy template weights positions=0.9, argumentation=0.9 → extract more position indicators, deeper argumentation patterns
3. Implement `_apply_domain_weighting(raw_features, template) -> weighted_features`
4. Store the applied weights in the profile metadata for traceability

**Files**:
- `joyus_profile/profile/generator.py` (updated, +40 lines)

**Validation**:
- [ ] Legal domain produces more detailed positions/argumentation
- [ ] Marketing domain produces more detailed voice/vocabulary
- [ ] General domain applies balanced weights

---

## Subtask T021: VoiceContext Population (Layer 0)

**Purpose**: Initialize VoiceContext from corpus analysis for the base single-voice profile.

**Steps**:
1. In ProfileGenerator, after building the base profile:
   - If audience analysis detects a single dominant register → Layer 0 (no voice_contexts)
   - If audience analysis detects multiple registers → create VoiceContext entries per detected audience
   - For initial implementation: always Layer 0 (single voice)
2. Set `voice_contexts = {}` (empty dict = Layer 0 behavior)
3. Document how to populate voice_contexts later (manual or via Phase B hierarchy)
4. Voice detection logic for future multi-audience support:
   ```python
   if len(audience.detected_audiences) > 1:
       # Layer 1: Create VoiceContext stubs for each detected audience
       for aud_key in audience.detected_audiences:
           profile.voice_contexts[aud_key] = VoiceContext(
               audience_key=aud_key,
               # Overrides populated during hierarchy building (Phase B)
           )
   ```

**Files**:
- `joyus_profile/profile/generator.py` (updated, +30 lines)

---

## Subtask T022: Confidence Scoring

**Purpose**: Compute profile confidence (0.0-1.0) based on corpus size and feature stability.

**Steps**:
1. Implement `_compute_confidence(corpus, features) -> float`:
   - Base confidence from corpus size: 5 docs = 0.5, 10 docs = 0.7, 20+ docs = 0.85, 50+ docs = 0.95
   - Adjust for feature stability: high variance in stylometric features → lower confidence
   - Adjust for fidelity tier: Tier 4 with sufficient data → higher confidence
   - Floor at 0.5 (minimum for usable profile)
2. Store confidence on the AuthorProfile
3. Log warning if confidence < 0.7 (profile may be unreliable)

**Files**:
- `joyus_profile/profile/generator.py` (updated, +30 lines)

**Validation**:
- [ ] 5-doc corpus → confidence ~0.5-0.6
- [ ] 20-doc corpus → confidence ~0.8-0.9
- [ ] High feature variance reduces confidence

---

## Subtask T023: SkillEmitter.emit()

**Purpose**: Convert an AuthorProfile into platform-consumable skill files.

**Steps**:
1. Create `joyus_profile/emit/skill_emitter.py`
2. Implement `SkillEmitter`:
   ```python
   class SkillEmitter:
       def emit(self, profile: AuthorProfile, output_dir: str) -> SkillFileSet:
           os.makedirs(output_dir, exist_ok=True)

           # 1. Write SKILL.md (human/Claude-readable)
           skill_md = self._generate_skill_md(profile)
           Path(output_dir, "SKILL.md").write_text(skill_md)

           # 2. Write markers.json
           markers = self._extract_markers(profile)
           Path(output_dir, "markers.json").write_text(json.dumps(markers, indent=2))

           # 3. Write stylometrics.json
           stylo = self._extract_stylometrics(profile)
           Path(output_dir, "stylometrics.json").write_text(json.dumps(stylo, indent=2))

           # 4. If voice_contexts present, write voices/ directory
           if profile.voice_contexts:
               voices_dir = Path(output_dir, "voices")
               voices_dir.mkdir(exist_ok=True)
               for key, vc in profile.voice_contexts.items():
                   (voices_dir / f"{key}.json").write_text(vc.model_dump_json(indent=2))

           return SkillFileSet(
               skill_md=str(Path(output_dir, "SKILL.md")),
               markers_json=str(Path(output_dir, "markers.json")),
               stylometrics_json=str(Path(output_dir, "stylometrics.json")),
           )
   ```
3. Define `SkillFileSet` model to track emitted files

**Files**:
- `joyus_profile/emit/skill_emitter.py` (new, ~100 lines)

**Validation**:
- [ ] Creates output_dir with SKILL.md, markers.json, stylometrics.json
- [ ] JSON files are valid JSON
- [ ] voices/ directory created only when voice_contexts are present

---

## Subtask T024: skill_md.py (Markdown Generation)

**Purpose**: Generate human/Claude-readable SKILL.md from profile sections.

**Steps**:
1. Create `joyus_profile/emit/skill_md.py`
2. Generate structured Markdown with all 12 profile sections:
   ```markdown
   # Writing Profile: {author_name}

   **Domain**: {domain} | **Fidelity**: Tier {tier} | **Confidence**: {confidence}
   **Corpus**: {doc_count} documents, {word_count} words

   ## Identity & Background
   {identity section}

   ## Voice & Tone
   Formality: {score}/10
   {voice description}

   ## Vocabulary
   ### Signature Phrases
   - {phrase 1}
   - {phrase 2}
   ### Preferred Terms
   ...
   ### Avoided Terms
   ...

   ## Positions & Stances
   ...

   ## Anti-Patterns (Never Do)
   ...
   ```
3. Keep SKILL.md under 500 lines for readability
4. Use clear headings that Claude can parse as skill context

**Files**:
- `joyus_profile/emit/skill_md.py` (new, ~120 lines)

**Validation**:
- [ ] Generated Markdown is well-formatted
- [ ] All 12 sections present (even if some are minimal)
- [ ] SKILL.md is under 500 lines

---

## Subtask T025: Validators for Emitted Files

**Purpose**: Validate schema correctness of emitted skill files.

**Steps**:
1. Create `joyus_profile/emit/validators.py`
2. Implement `validate(output_dir: str) -> ValidationResult`:
   - Check SKILL.md exists and has required sections
   - Check markers.json parses and matches MarkerSet schema
   - Check stylometrics.json parses and has expected feature count
   - Check voices/*.json files match VoiceContext schema (if present)
3. Return `ValidationResult` with pass/fail + list of issues

**Files**:
- `joyus_profile/emit/validators.py` (new, ~60 lines)

**Validation**:
- [ ] Valid skill files pass validation
- [ ] Missing files fail with clear error message
- [ ] Malformed JSON fails with parse error details

---

## Definition of Done

- [ ] `ProfileGenerator(domain="general").build(corpus, "Test Author")` returns complete AuthorProfile
- [ ] `SkillEmitter().emit(profile, output_dir)` creates valid skill files
- [ ] Domain templates influence section weighting
- [ ] Confidence scoring reflects corpus quality
- [ ] `SkillEmitter().validate(output_dir)` passes on emitted files
- [ ] All tests pass, no ruff/mypy errors

## Risks

- **Profile section mapping**: The mapping from analyzer outputs to 12 profile sections requires careful design. Some sections (argumentation, citations) need cross-analyzer data.
- **SKILL.md readability**: The Markdown must work both for human review and as Claude skill context. Test with a real Claude prompt to verify.
