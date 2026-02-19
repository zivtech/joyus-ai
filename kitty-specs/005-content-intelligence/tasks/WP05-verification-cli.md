---
work_package_id: WP05
title: Two-Tier Verification + CLI
lane: planned
dependencies: [WP04]
subtasks: [T026, T027, T028, T029, T030, T031]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP05: Two-Tier Verification + CLI

## Objective

Implement the two-tier verification system (Tier 1 inline <500ms, Tier 2 deep analysis) and CLI commands for building profiles and verifying content.

## Implementation Command

```bash
spec-kitty implement WP05 --base WP04
```

## Context

- **Plan**: plan.md §A.6
- **Spec**: spec.md §6.2 (Continuous Monitoring — Tier 1/Tier 2)
- **API Contract**: contracts/profile-engine-api.md §Verify
- **Research**: research.md §R1 (faststylometry scoring)

---

## Subtask T026: CLI Build Command

**Purpose**: Command-line interface for building profiles from a corpus.

**Steps**:
1. Create `joyus_profile/cli/__init__.py` with click group
2. Create `cli/build_profile.py`:
   ```python
   @click.command()
   @click.option("--corpus", required=True, help="Path to document directory")
   @click.option("--author", required=True, help="Author name")
   @click.option("--domain", default="general", help="Domain template")
   @click.option("--output", required=True, help="Output directory for skill files")
   @click.option("--formats", default=None, help="Comma-separated formats to load")
   def build(corpus, author, domain, output, formats):
       loader = CorpusLoader()
       corpus_data = loader.load_directory(corpus, formats=formats.split(",") if formats else None)
       preprocessor = Preprocessor()
       processed = preprocessor.process(corpus_data)
       generator = ProfileGenerator(domain=domain)
       profile = generator.build(processed, author_name=author)
       emitter = SkillEmitter()
       result = emitter.emit(profile, output_dir=output)
       click.echo(f"Profile built: {result.skill_md}")
   ```
3. Register as `joyus-profile build` entry point

**Files**:
- `joyus_profile/cli/__init__.py` (new, ~20 lines)
- `joyus_profile/cli/build_profile.py` (new, ~50 lines)

**Validation**:
- [ ] `joyus-profile build --corpus ./fixtures/example/ --author "Test" --domain general --output /tmp/test/` creates skill files

---

## Subtask T027: InlineChecker (Tier 1)

**Purpose**: Fast verification (<500ms) using marker presence and basic stylometric distance.

**Steps**:
1. Create `joyus_profile/verify/inline_checker.py`
2. Implement `InlineChecker`:
   ```python
   class InlineChecker:
       def check(self, text: str, profile: AuthorProfile,
                 voice_key: str | None = None) -> InlineResult:
           start = time.perf_counter()

           # 1. Marker check: presence of high-signal markers
           marker_score = self._check_markers(text, profile)

           # 2. Basic style check: top-20 function words only (fast)
           style_score = self._check_basic_style(text, profile)

           # 3. Prohibited framing check
           has_prohibited = self._check_prohibited(text, profile)

           score = (marker_score * 0.6 + style_score * 0.4)
           if has_prohibited:
               score *= 0.5  # Heavy penalty

           latency = (time.perf_counter() - start) * 1000

           return InlineResult(
               score=score,
               passed=score >= self._threshold(profile.fidelity_tier),
               feedback=self._generate_feedback(marker_score, style_score, has_prohibited) if score < threshold else None,
               latency_ms=latency,
           )
   ```
3. **Critical performance constraint**: Must complete in <500ms per 1000 words
   - Use only top-20 function words (not full 129 features)
   - Pre-compute marker lookup sets (O(1) membership test)
   - No spaCy call in Tier 1 — use simple tokenization
4. Threshold by tier: Tier 1=0.5, Tier 2=0.6, Tier 3=0.7, Tier 4=0.75

**Files**:
- `joyus_profile/verify/inline_checker.py` (new, ~120 lines)

**Validation**:
- [ ] Completes in <500ms for 1000-word text
- [ ] Known-good text scores >0.7
- [ ] Text with prohibited framings scores significantly lower
- [ ] Returns actionable feedback when score below threshold

---

## Subtask T028: DeepAnalyzer (Tier 2)

**Purpose**: Full 129-feature Burrows' Delta analysis with cross-document consistency.

**Steps**:
1. Create `joyus_profile/verify/deep_analyzer.py`
2. Implement `DeepAnalyzer`:
   ```python
   class DeepAnalyzer:
       def analyze(self, text: str, profile: AuthorProfile,
                   history: list[str] | None = None) -> DeepResult:
           # 1. Full stylometric extraction on the text
           corpus = self._text_to_corpus(text)
           features = StylometricAnalyzer().extract(corpus)

           # 2. Burrows' Delta against profile baseline
           delta = self._compute_delta(features, profile)

           # 3. Per-feature breakdown
           breakdown = self._feature_breakdown(features, profile)

           # 4. Cross-document consistency (if history provided)
           drift = self._check_consistency(features, history) if history else False

           return DeepResult(
               burrows_delta=delta,
               feature_breakdown=breakdown,
               drift_detected=drift,
               recommendations=self._generate_recommendations(delta, breakdown),
           )
   ```
3. This is the async analysis — no latency constraint, but target <60s per document
4. Per-feature breakdown shows which of the 129 features diverge most from the profile

**Files**:
- `joyus_profile/verify/deep_analyzer.py` (new, ~120 lines)

**Validation**:
- [ ] Returns valid DeepResult with delta score
- [ ] Feature breakdown identifies top divergent features
- [ ] Cross-document consistency check detects variance spikes

---

## Subtask T029: FidelityScorer

**Purpose**: Unified scoring interface that combines Tier 1 and Tier 2 results.

**Steps**:
1. Create `joyus_profile/verify/scorer.py`
2. Implement `FidelityScorer`:
   ```python
   class FidelityScorer:
       def score(self, text: str, profile: AuthorProfile,
                 tier: Literal[1, 2, "both"] = "both") -> FidelityScore:
           if tier == 1 or tier == "both":
               inline = InlineChecker().check(text, profile)
           if tier == 2 or tier == "both":
               deep = DeepAnalyzer().analyze(text, profile)

           # Combine scores
           if tier == "both":
               combined = inline.score * 0.4 + (1.0 - deep.burrows_delta) * 0.6
           # ...
           return FidelityScore(score=combined, passed=combined >= threshold, ...)
   ```
3. Normalize Burrows' Delta (distance) to 0-1 score (inverted — lower delta = higher score)
4. Return per-feature breakdown from Tier 2 when available

**Files**:
- `joyus_profile/verify/scorer.py` (new, ~60 lines)

---

## Subtask T030: Feedback Generator

**Purpose**: Generate actionable feedback when verification fails.

**Steps**:
1. Create `joyus_profile/verify/feedback.py`
2. Map score components to human-readable feedback:
   ```python
   def generate_feedback(inline: InlineResult, deep: DeepResult | None) -> str:
       issues = []
       if inline.marker_score < 0.6:
           issues.append(f"Missing signature phrases: consider using '{profile.top_markers[:3]}'")
       if inline.style_score < 0.6:
           issues.append("Sentence length diverges from author's typical range")
       if deep and deep.burrows_delta > 1.0:
           issues.append("Overall style significantly different from author baseline")
       return "\n".join(issues) if issues else None
   ```
3. Feedback should be usable by an LLM for self-correction (concise, specific, actionable)

**Files**:
- `joyus_profile/verify/feedback.py` (new, ~60 lines)

---

## Subtask T031: CLI Verify Command

**Purpose**: Command-line interface for content verification.

**Steps**:
1. Create `cli/verify_content.py`:
   ```python
   @click.command()
   @click.option("--text", required=True, help="Path to text file to verify")
   @click.option("--profile", required=True, help="Path to profile skill directory")
   @click.option("--tier", default="both", type=click.Choice(["1", "2", "both"]))
   @click.option("--voice", default=None, help="Voice key for multi-audience check")
   def verify(text, profile, tier, voice):
       # Load profile from skill files
       # Run FidelityScorer
       # Print formatted results
   ```
2. Output formatted results (as shown in quickstart.md §3)
3. Register as `joyus-profile verify` entry point

**Files**:
- `joyus_profile/cli/verify_content.py` (new, ~60 lines)

**Validation**:
- [ ] `joyus-profile verify --text sample.md --profile ./skills/author/ --tier both` produces formatted output

---

## Definition of Done

- [ ] Tier 1 verification completes in <500ms per 1000 words
- [ ] Tier 2 verification produces per-feature breakdown
- [ ] `FidelityScorer.score()` combines both tiers
- [ ] CLI `build` and `verify` commands work end-to-end
- [ ] Feedback is actionable and specific
- [ ] All tests pass

## Risks

- **Tier 1 latency**: If marker lookup is slow, pre-build a `frozenset` at profile load time.
- **Delta normalization**: Burrows' Delta is unbounded — need empirical calibration to map to 0-1 range.
