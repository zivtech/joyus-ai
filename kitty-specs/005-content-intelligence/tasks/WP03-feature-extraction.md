---
work_package_id: WP03
title: Feature Extraction (129 Features)
lane: planned
dependencies: [WP02]
subtasks: [T012, T013, T014, T015, T016, T017, T018]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP03: Feature Extraction (129 Features)

## Objective

Implement all six analyzers that extract the 129-feature stylometric vector from processed corpora. The StylometricAnalyzer wraps faststylometry; others use spaCy and custom NLP.

## Implementation Command

```bash
spec-kitty implement WP03 --base WP02
```

## Context

- **Plan**: plan.md §A.3
- **Research**: research.md §R1 (faststylometry API), §R2 (spaCy model selection)
- **API Contract**: contracts/profile-engine-api.md §Analyze
- **Data Models**: `StylometricFeatures`, `MarkerSet`, `VocabularyProfile`, `StructuralPatterns`, `AudienceProfile` from WP01

**Key research findings**:
- faststylometry 1.0.15: `Corpus.add_file()` → `tokenise_remove_pronouns_en()` → `calculate_burrows_delta(test_corpus)`
- faststylometry Corpus not thread-safe — use per-request instances
- spaCy `en_core_web_md` recommended (900K wps, 0.870 dep accuracy)
- Disable NER for speed: `spacy.load("en_core_web_md", exclude=["ner"])`

---

## Subtask T012: StylometricAnalyzer (faststylometry Wrapper)

**Purpose**: Thin wrapper over faststylometry for Burrows' Delta computation.

**Steps**:
1. Create `joyus_profile/analyze/stylometrics.py`
2. Implement `StylometricAnalyzer`:
   ```python
   from faststylometry import Corpus as FastCorpus

   class StylometricAnalyzer:
       def extract(self, corpus: ProcessedCorpus) -> StylometricFeatures:
           # Build faststylometry Corpus from our ProcessedCorpus
           fast_corpus = FastCorpus()
           for doc in corpus.corpus.documents:
               fast_corpus.add_file(
                   doc.metadata.author or "unknown",
                   doc.doc_id,
                   doc.text
               )
           fast_corpus.tokenise_remove_pronouns_en()

           # Extract function word frequencies from tokenized corpus
           function_words = self._extract_function_words(fast_corpus)

           # Compute self-distance baseline (Burrows' Delta of author against self)
           baseline = self._compute_self_distance(fast_corpus)

           return StylometricFeatures(
               function_word_frequencies=function_words,
               burrows_delta_baseline=baseline,
               # Other fields populated by T013 custom features
           )

       def score_against(self, text: str, profile_corpus: FastCorpus) -> float:
           """Score a text against a pre-built faststylometry Corpus."""
           test = FastCorpus()
           test.add_file("test", "output", text)
           test.tokenise_remove_pronouns_en()
           df = profile_corpus.calculate_burrows_delta(test)
           return float(df.iloc[0, 0])  # lower = better match
   ```
3. Keep the wrapper thin — faststylometry handles the math
4. Store the `FastCorpus` object alongside the profile for later verification use

**Files**:
- `joyus_profile/analyze/stylometrics.py` (new, ~100 lines)

**Validation**:
- [ ] `extract()` returns StylometricFeatures with non-empty function_word_frequencies
- [ ] `score_against()` returns a float delta (lower = better match)
- [ ] Works with corpora of >=2 documents

---

## Subtask T013: Custom Feature Extraction

**Purpose**: Extract the features faststylometry doesn't cover: sentence length, punctuation, character n-grams, POS n-grams.

**Steps**:
1. Add methods to `StylometricAnalyzer` or create a helper module:
   ```python
   def _extract_sentence_stats(self, corpus: ProcessedCorpus) -> SentenceLengthStats:
       # Use spaCy for sentence segmentation
       nlp = spacy.load("en_core_web_md", exclude=["ner"])
       lengths = []
       for chunk in corpus.chunks:
           doc = nlp(chunk.text)
           lengths.extend(len(sent) for sent in doc.sents)
       return SentenceLengthStats(
           mean=np.mean(lengths),
           median=np.median(lengths),
           std=np.std(lengths),
           min=min(lengths),
           max=max(lengths),
           distribution=np.histogram(lengths, bins=20)[0].tolist(),
       )

   def _extract_punctuation_ratios(self, corpus) -> dict[str, float]:
       # Count .,;:!?-()""'' per total tokens

   def _extract_character_ngrams(self, corpus, n=3) -> dict[str, float]:
       # Character trigram frequencies (top 100)

   def _extract_pos_ngrams(self, corpus, n=2) -> dict[str, float]:
       # POS bigram frequencies from spaCy
   ```
2. Merge all features into the `StylometricFeatures` model
3. Set `feature_count` to the total number of extracted features

**Files**:
- `joyus_profile/analyze/stylometrics.py` (updated, +80 lines)

**Validation**:
- [ ] Sentence stats computed across all chunks
- [ ] Punctuation ratios sum to <=1.0
- [ ] Character n-grams are top-100 by frequency
- [ ] POS n-grams use spaCy's universal POS tags

---

## Subtask T014: MarkerAnalyzer

**Purpose**: Identify domain-specific terms and phrases with weighted scoring.

**Steps**:
1. Create `joyus_profile/analyze/markers.py`
2. Implement `MarkerAnalyzer`:
   ```python
   class MarkerAnalyzer:
       def extract(self, corpus: ProcessedCorpus, domain: str = "general") -> MarkerSet:
           # 1. Extract candidate phrases (1-4 grams)
           # 2. Score by TF-IDF or frequency
           # 3. Classify into high_signal, medium_signal, negative_markers
           # 4. Apply domain template hints if available
   ```
3. High-signal markers: phrases that appear frequently AND are distinctive (high TF-IDF)
4. Medium-signal markers: frequent but less distinctive
5. Negative markers: phrases the author never uses (useful for verification)
6. Domain awareness: load template from WP01 T006 for domain-specific term boosting

**Files**:
- `joyus_profile/analyze/markers.py` (new, ~120 lines)

**Validation**:
- [ ] Returns MarkerSet with populated high_signal, medium_signal lists
- [ ] Negative markers correctly identified (absent from all documents)
- [ ] Domain template influences marker scoring

---

## Subtask T015: VocabularyAnalyzer

**Purpose**: Extract preferred/avoided terms, signature phrases, and type-token ratio.

**Steps**:
1. Create `joyus_profile/analyze/vocabulary.py`
2. Implement `VocabularyAnalyzer`:
   - `signature_phrases`: Multi-word expressions unique to this author (PMI-based extraction)
   - `preferred_terms`: Words used significantly more than baseline frequency
   - `avoided_terms`: Common words the author systematically avoids
   - `technical_terms`: Domain-specific terminology (NER + frequency analysis)
3. Use spaCy for tokenization and NER

**Files**:
- `joyus_profile/analyze/vocabulary.py` (new, ~100 lines)

**Validation**:
- [ ] Signature phrases are multi-word (2-4 tokens)
- [ ] Preferred terms differ from generic English frequency lists

---

## Subtask T016: StructureAnalyzer

**Purpose**: Extract document-level and paragraph-level structural patterns.

**Steps**:
1. Create `joyus_profile/analyze/structure.py`
2. Implement `StructureAnalyzer`:
   - `avg_paragraph_length`: Mean words per paragraph
   - `avg_paragraphs_per_doc`: Document structure metric
   - `heading_frequency`: How often headings appear
   - `list_usage_ratio`: Ratio of list items to total content
   - `citation_density`: References per 1000 words
3. Use regex-based detection for headings, lists, citations

**Files**:
- `joyus_profile/analyze/structure.py` (new, ~80 lines)

---

## Subtask T017: AudienceAnalyzer

**Purpose**: Detect the writing register (formal/informal/technical) and target audiences.

**Steps**:
1. Create `joyus_profile/analyze/audience.py`
2. Implement `AudienceAnalyzer`:
   - `primary_register`: Classify based on formality indicators (passive voice ratio, Latinate vs Germanic vocabulary, sentence complexity)
   - `formality_score`: 0-10 scale based on weighted features
   - `detected_audiences`: Infer from vocabulary and structure (e.g., "courts" if heavy legal citation, "general public" if simple vocabulary)
3. Use POS ratios and vocabulary complexity as primary signals

**Files**:
- `joyus_profile/analyze/audience.py` (new, ~80 lines)

---

## Subtask T018: Regression Tests for Feature Extraction

**Purpose**: Ensure feature extraction produces consistent, reproducible results.

**Steps**:
1. Create `tests/unit/test_analyze/` with test files for each analyzer
2. Create `tests/regression/test_feature_consistency.py`:
   - Run all 6 analyzers on fixtures/example/
   - Snapshot expected output (or compute golden values on first run)
   - Assert subsequent runs produce identical results (deterministic)
3. Test edge cases:
   - Empty corpus → appropriate error
   - Single document → partial features with warning
   - Very short documents (<50 words) → reduced feature set

**Files**:
- `tests/unit/test_analyze/test_stylometrics.py` (new)
- `tests/unit/test_analyze/test_markers.py` (new)
- `tests/unit/test_analyze/test_vocabulary.py` (new)
- `tests/unit/test_analyze/test_structure.py` (new)
- `tests/unit/test_analyze/test_audience.py` (new)
- `tests/regression/test_feature_consistency.py` (new)

**Validation**:
- [ ] All unit tests pass
- [ ] Feature extraction is deterministic (same input → same output)
- [ ] Edge cases handled gracefully

---

## Definition of Done

- [ ] All 6 analyzers implemented and importable
- [ ] `StylometricAnalyzer().extract(corpus)` returns 129+ features
- [ ] `MarkerAnalyzer().extract(corpus)` returns categorized markers
- [ ] All unit and regression tests pass
- [ ] `ruff check joyus_profile/analyze/` passes
- [ ] spaCy `en_core_web_md` model loads and processes text

## Risks

- **spaCy Python version**: If running Python 3.13+, spaCy may not install. Pin Python 3.12 in pyproject.toml `requires-python = ">=3.11,<3.14"`.
- **faststylometry requires >=2 authors**: For single-author corpora, create a synthetic "baseline" author from generic English text for delta comparison.
- **Feature count**: The "129 features" is a target — the actual count depends on vocabulary size and n-gram pruning. Track `feature_count` to document the actual number.
