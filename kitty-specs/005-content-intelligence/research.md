# Research: Content Intelligence Python Engine

**Feature**: 005-content-intelligence
**Date**: 2026-02-19
**Source**: Parallel scientist agent research (5 topics)

---

## Research Questions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| R1 | Which stylometry library to use? | faststylometry 1.0.15 | Complete Burrows' Delta pipeline, minimal deps (numpy, pandas, scipy), pandas output |
| R2 | Which spaCy model for syntactic features? | en_core_web_md | Best CPU speed/accuracy tradeoff: 900K wps, 0.870 dep accuracy, 43MB |
| R3 | Which MCP server SDK? | Official `mcp` 1.26 SDK | Stable, async-native, already available; FastMCP 3.0 too new |
| R4 | Composite profile algorithm? | Corpus-size weighted mean | Principled; handles unequal contributor volume; incremental updates |
| R5 | Closed-loop generation strategy? | Best-of-N (Phase 1), Constraint Tightening (Phase 2) | Deferred to implementation; research provides starting parameters |

---

## R1: faststylometry API

**Decision**: Thin wrapper over faststylometry 1.0.15

faststylometry provides a complete Burrows' Delta pipeline in 7 core methods:

| Method | Purpose |
|--------|---------|
| `load_corpus_from_folder(folder, pattern)` | Load .txt files into Corpus |
| `add_file(author, title, text)` | Add a single document programmatically |
| `tokenise(tokeniser_func)` | Apply custom tokeniser |
| `tokenise_remove_pronouns_en()` | Built-in English tokeniser (standard for Delta) |
| `calculate_burrows_delta(test_corpus)` | Returns pd.DataFrame of Delta scores |
| `calibrate(train_corpus)` | Fits isotonic regression for probability calibration |
| `predict_proba(test_corpus)` | Returns P(same author) after calibration |

**Distance metrics**: Classic Burrows' Delta, Scaled Burrows' Delta, Cosine Delta.

**Wrapper pattern** (3 method calls for complete pipeline):

```python
from faststylometry import Corpus

def build_profile_corpus(author_id: str, texts: list[str]) -> Corpus:
    c = Corpus()
    for i, text in enumerate(texts):
        c.add_file(author_id, f"doc_{i}", text)
    c.tokenise_remove_pronouns_en()
    return c

def score_against_profile(generated: str, profile_corpus: Corpus) -> float:
    test = Corpus()
    test.add_file("generated", "output", generated)
    test.tokenise_remove_pronouns_en()
    df = profile_corpus.calculate_burrows_delta(test)
    return float(df.iloc[0, 0])  # lower = better match
```

**Gotchas**:
- Corpus must have >=2 authors for meaningful delta comparisons
- `tokenise()` must be called before `calculate_burrows_delta()`
- `calibrate()` requires a separate held-out train corpus
- No POS-tag features built in — spaCy features extracted separately and merged
- Not thread-safe at Corpus level — use per-request instances for concurrent MCP calls

**Alternatives considered**: None viable — faststylometry is the only maintained Python Burrows' Delta library with calibration support.

---

## R2: spaCy Pipeline Selection

**Decision**: en_core_web_md on Python 3.12

| Model | Size | Dep Acc | NER F1 | CPU Speed (wps) | Notes |
|-------|------|---------|--------|-----------------|-------|
| en_core_web_sm | 12 MB | 0.862 | 0.849 | ~1,000,000 | No vectors |
| **en_core_web_md** | **43 MB** | **0.870** | **0.855** | **~900,000** | **RECOMMENDED** |
| en_core_web_lg | 587 MB | 0.870 | 0.857 | ~850,000 | 14x larger, marginal gain |
| en_core_web_trf | 438 MB | 0.925 | 0.900 | ~18,000 | GPU required, 50x slower |

**Rationale**: Stylometric features are primarily syntactic (POS tags, dependency arcs, sentence length distributions) — areas where md and lg are equivalent. The 300-d GloVe vectors in md enable vocabulary-level similarity. The 50x speed penalty of trf is unacceptable for batch processing.

**Python version constraint**: spaCy 3.x is incompatible with Python 3.14 (pydantic v1 ConfigError confirmed). Production must use Python <=3.12.

**Key features extractable via spaCy**:
- POS distribution (ratio of NOUN, VERB, ADJ, ADV, PUNCT, etc.)
- Dependency arc length distribution
- Sentence length statistics
- Punctuation density
- Function word ratio (closed-class words)

**Optimization**: Disable unused pipeline components: `nlp = spacy.load("en_core_web_md", exclude=["ner"])` when only POS/dep needed.

---

## R3: Python MCP Server Pattern

**Decision**: Official `mcp` 1.26 SDK with stdio transport

Two patterns evaluated:

**Pattern A — Official SDK (CHOSEN)**:
- Decorator-based tool registration (`@server.list_tools()`, `@server.call_tool()`)
- JSON Schema input schemas defined explicitly
- Async handlers with `asyncio.to_thread()` for sync faststylometry calls
- Stable, well-documented, already installed

**Pattern B — FastMCP 3.0 (NOT CHOSEN)**:
- Simpler decorator API (`@mcp.tool`)
- Auto-generates input schemas from Python type hints
- Released 2026-02-18 (1 day before research) — too new for production

**Gotchas**:
- Never write debug output to stdout — corrupts MCP stdio protocol; use stderr
- All MCP handlers must be `async def`; wrap sync calls in `asyncio.to_thread()`
- FastMCP 3.x is a separate package from `mcp`; do not mix
- Transport: stdio for local (Claude Desktop); SSE/HTTP for network service

---

## R4: Composite Profile Algorithms

**Decision**: Corpus-size weighted mean (default)

Three algorithms compared via simulation (n=50 features, 4 authors):

| Algorithm | Cosine Sim to Members | L2 Norm | Use Case |
|-----------|----------------------|---------|----------|
| Simple mean | 0.443 | 3.048 | Equal-contribution teams |
| **Weighted mean** | **0.426** | **2.910** | **Department profiles (DEFAULT)** |
| Intersection-masked | 0.345 | 2.294 | Strict shared-vocabulary enforcement |

**Key design decisions**:
- Use `weighted_mean` as default in `build_group_profile`
- Use cosine similarity (not Euclidean) for profile comparison — scale-invariant
- Vocabulary union: include all features from all authors; zero-fill absent features
- Use `intersection_masked` only for strict voice enforcement
- Incremental update: `new = (old * old_total + new_vec * new_size) / (old_total + new_size)`

---

## R5: Closed-Loop Generation+Verification

**Decision**: Deferred to implementation. Research provides starting parameters.

| Approach | Fidelity | Latency | Complexity | Phase |
|----------|----------|---------|------------|-------|
| Self-Refine | Medium | 2–4x | Low | No — unreliable for stylometry |
| **Best-of-N (N=4–8)** | **High** | **N×** | **Low** | **Phase 1** |
| **Constraint Tightening** | **Highest** | **2.5–3.5×** | **Medium** | **Phase 2** |
| PASR (fine-tuned) | High | 0.6x | Very High | No — requires fine-tuning |

**Best-of-N** (Phase 1): Generate N candidates, score each against profile via faststylometry delta, return lowest-delta candidate. Simulation shows 61.1% delta improvement at N=8.

**Iterative Constraint Tightening** (Phase 2): Generate → score → translate delta into prose constraints → regenerate. Max 3 rounds. Maps to VoiceContext fidelity tiers:

| VoiceContext Tier | Delta Threshold | N (best-of-N) | Rounds (constraint) |
|-------------------|----------------|---------------|---------------------|
| Tier 1 (General) | < 1.0 | N=2 | 1 |
| Tier 2 (Advocate) | < 0.7 | N=4 | 2 |
| Tier 4 (Expert) | < 0.4 | N=8 | 3 |

**Note**: Delta thresholds require calibration on held-out author samples — these are starting estimates.

---

## Limitations

1. spaCy/Python 3.14 incompatibility confirmed. Production must use Python 3.12.
2. faststylometry API confirmed from documentation, not live execution.
3. Composite profile simulation uses synthetic random vectors — real stylometric vectors may behave differently.
4. Best-of-8 delta improvement (61.1%) is illustrative — real improvement depends on LLM temperature and profile strength.
5. FastMCP 3.0 stability unverified — recommend official `mcp` SDK until 3.x matures.
6. Delta threshold values require calibration on real author corpora before production use.

---

## Sources

### faststylometry
- [faststylometry PyPI](https://pypi.org/project/faststylometry/)
- [faststylometry GitHub](https://github.com/fastdatascience/faststylometry)
- [Fast Data Science blog](https://fastdatascience.com/natural-language-processing/fast-stylometry-python-library/)

### spaCy
- [spaCy Models Documentation](https://spacy.io/models)
- [spaCy Discussion #12849 (lg vs trf)](https://github.com/explosion/spaCy/discussions/12849)
- [spaCy Facts & Figures](https://spacy.io/usage/facts-figures)

### MCP Server
- [modelcontextprotocol/python-sdk GitHub](https://github.com/modelcontextprotocol/python-sdk)
- [mcp PyPI](https://pypi.org/project/mcp/1.7.1/)
- [FastMCP GitHub](https://github.com/jlowin/fastmcp)

### Composite Profiles
- [Stylometry Analysis of Multi-authored Documents (arXiv 2024)](https://arxiv.org/html/2401.06752v1)
- [Learning Stylometric Representations (McGill/ICLR)](https://dmas.lab.mcgill.ca/fung/pub/DFIC19cyb_postprint.pdf)
- [Authorship Attribution Survey (MDPI 2024)](https://www.mdpi.com/2078-2489/15/3/131)

### Closed-Loop Generation
- [Self-Refine (arXiv 2303.17651)](https://arxiv.org/abs/2303.17651)
- [StyleRec (arXiv 2504.04373)](https://arxiv.org/abs/2504.04373)
