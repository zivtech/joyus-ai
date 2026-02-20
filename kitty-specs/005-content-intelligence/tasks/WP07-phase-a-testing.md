---
work_package_id: WP07
title: Phase A Integration + Regression Testing
lane: "for_review"
dependencies: [WP06]
base_branch: 005-content-intelligence-WP06
base_commit: a2df474e7bb2a568c0c63df0914190f18bfe7a14
created_at: '2026-02-20T04:46:19.818929+00:00'
subtasks: [T036, T037, T038]
shell_pid: "19485"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP07: Phase A Integration + Regression Testing

## Objective

Validate Phase A end-to-end: port PoC accuracy tests, run full corpus-to-verification pipeline, and measure performance against targets.

## Implementation Command

```bash
spec-kitty implement WP07 --base WP06
```

## Context

- **Spec**: spec.md §10 (Success Criteria)
- **Quickstart**: quickstart.md §6, §7 (tests, verification checklist)

---

## Subtask T036: Port PoC Accuracy Tests

**Purpose**: Regression suite ensuring attribution accuracy is maintained.

**Steps**:
1. Create `tests/regression/test_accuracy.py`
2. Port the two key benchmarks from the PoC:
   - **4-author test**: >=94.6% accuracy on cross-validated attribution
   - **9-author test**: >=97.9% accuracy on cross-validated attribution
3. Test methodology:
   - Build profiles for each author from training split (80%)
   - Run attribution on held-out test split (20%)
   - Measure accuracy as: correct top-1 matches / total tests
4. Use anonymized fixture data (create `fixtures/regression/` with sample texts)
5. Mark as `@pytest.mark.slow` — these tests take minutes

**Files**:
- `tests/regression/test_accuracy.py` (new, ~80 lines)
- `fixtures/regression/` (sample anonymized texts for 4-9 authors)

**Validation**:
- [ ] 4-author accuracy >= 94.6%
- [ ] 9-author accuracy >= 97.9%
- [ ] Tests are reproducible (same data → same results)

---

## Subtask T037: End-to-End Pipeline Test

**Purpose**: Full pipeline test from corpus ingestion through verification.

**Steps**:
1. Create `tests/integration/test_end_to_end.py`
2. Test the complete flow:
   ```python
   def test_full_pipeline():
       # 1. Load corpus
       loader = CorpusLoader()
       corpus = loader.load_directory("fixtures/example/")

       # 2. Preprocess
       processed = Preprocessor().process(corpus)

       # 3. Build profile
       profile = ProfileGenerator(domain="general").build(processed, "Test Author")
       assert profile.confidence >= 0.5

       # 4. Emit skill files
       emitter = SkillEmitter()
       result = emitter.emit(profile, "/tmp/test-e2e/")
       assert Path("/tmp/test-e2e/SKILL.md").exists()

       # 5. Validate skill files
       validation = emitter.validate("/tmp/test-e2e/")
       assert validation.passed

       # 6. Verify content against profile
       scorer = FidelityScorer()
       # Use a document from the same author
       score = scorer.score(corpus.documents[0].text, profile, tier="both")
       assert score.passed
       assert score.score >= 0.7  # Same-author text should score well
   ```
3. Also test with "wrong author" text — should score low

**Files**:
- `tests/integration/test_end_to_end.py` (new, ~80 lines)

**Validation**:
- [ ] Full pipeline completes without errors
- [ ] Same-author text passes verification
- [ ] Different-author text fails verification (or scores significantly lower)

---

## Subtask T038: Performance Tests

**Purpose**: Verify performance targets from spec.md §10.

**Steps**:
1. Create `tests/integration/test_performance.py`
2. Test targets:
   - **Tier 1 verification**: <500ms per 1000-word document
   - **Tier 1 profile build**: <30 seconds from 300+ words
   - **Tier 2 profile build**: <5 minutes from 2,000+ words
   - **Tier 4 profile build**: <30 minutes from 50,000+ words (skip in CI, run manually)
3. Use `time.perf_counter()` for accurate measurements
4. Mark long tests with `@pytest.mark.slow`

**Files**:
- `tests/integration/test_performance.py` (new, ~60 lines)

**Validation**:
- [ ] Tier 1 latency <500ms consistently
- [ ] Profile build times within targets
- [ ] Performance doesn't degrade with larger corpora (linear scaling)

---

## Definition of Done

- [ ] All accuracy regression tests pass (94.6%, 97.9%)
- [ ] End-to-end pipeline test passes
- [ ] Performance targets met (Tier 1 <500ms, builds within time budgets)
- [ ] Phase A is feature-complete and validated

## Risks

- **Fixture data quality**: Anonymized fixtures may not have the same stylometric properties as real author data. Accuracy numbers may differ.
- **Performance on CI**: CI machines may be slower — use generous margins or mark slow tests as optional.

## Activity Log

- 2026-02-20T04:56:23Z – unknown – shell_pid=19485 – lane=for_review – Moved to for_review
