# Quickstart: Content Intelligence (Profile Engine)

**Feature**: 005-content-intelligence
**Date**: 2026-02-19

---

## Prerequisites

- Python >=3.11
- pip or uv (package manager)
- A document corpus (minimum 5 documents per author for viable profiles)

## 1. Install

```bash
cd joyus-profile-engine
pip install -e ".[dev]"

# Download spaCy model (required for Tier 3-4 analysis)
python -m spacy download en_core_web_md
```

## 2. Build a Profile

### From CLI

```bash
# Build a person-level profile
joyus-profile build \
    --corpus ./fixtures/example/ \
    --author "Example Author" \
    --domain general \
    --output ./output/skills/example-author/
```

### From Python

```python
from joyus_profile.ingest import CorpusLoader, Preprocessor
from joyus_profile.profile import ProfileGenerator
from joyus_profile.emit import SkillEmitter

# Load and preprocess
loader = CorpusLoader()
corpus = loader.load_directory("./fixtures/example/")
preprocessor = Preprocessor()
processed = preprocessor.process(corpus)

# Build profile
generator = ProfileGenerator(domain="general")
profile = generator.build(processed, author_name="Example Author")

# Emit skill files
emitter = SkillEmitter()
emitter.emit(profile, output_dir="./output/skills/example-author/")
```

### Expected Output

```
output/skills/example-author/
├── SKILL.md              # Human/Claude-readable writing profile
├── markers.json          # Content markers for Tier 1 verification
└── stylometrics.json     # Feature baselines for Tier 2 analysis
```

## 3. Verify Content

```bash
# Check content against a profile
joyus-profile verify \
    --text ./sample-output.md \
    --profile ./output/skills/example-author/ \
    --tier both
```

Expected output:
```
Tier 1 (Inline):  0.78/1.0 ✓ PASS
  Markers:        0.82 (12/15 high-signal present, 0 negative)
  Style:          0.72 (sentence length OK, vocabulary match good)

Tier 2 (Deep):    0.71/1.0 ✓ PASS
  Burrows' Delta: 0.94 (within baseline: 0.82 ± 0.11)
  Drift:          None detected

Overall: PASS
```

## 4. Run MCP Server

```bash
# Start the MCP server
joyus-profile serve --port 8080

# Or run as stdio MCP server (for Claude Desktop/Code)
joyus-profile serve --stdio
```

### Configure in Claude Desktop

Add to your Claude Desktop config:

```json
{
    "mcpServers": {
        "joyus-profile-engine": {
            "command": "joyus-profile",
            "args": ["serve", "--stdio"]
        }
    }
}
```

## 5. Build a Hierarchy (Phase B)

```bash
# Define departments in YAML
cat > departments.yaml << 'EOF'
credit_reporting:
    name: "Credit Reporting"
    members: ["author-001", "author-002", "author-003"]
    domain: "credit_reporting"
banking_payments:
    name: "Banking & Payments"
    members: ["author-001", "author-004", "author-005"]
    domain: "banking"
EOF

# Build hierarchy
joyus-profile build-hierarchy \
    --profiles ./skills/people/ \
    --departments departments.yaml \
    --org org.yaml \
    --output ./skills/
```

## 6. Run Tests

```bash
# All tests
pytest

# Unit tests only
pytest tests/unit/

# Regression (accuracy) tests
pytest tests/regression/ -v

# Integration tests
pytest tests/integration/ -v

# With coverage
pytest --cov=joyus_profile --cov-report=term-missing
```

## 7. Verification Checklist

After setup, verify:

| Check | Command | Expected |
|-------|---------|----------|
| Package installs | `pip install -e ".[dev]"` | No errors |
| spaCy model loads | `python -c "import spacy; spacy.load('en_core_web_md')"` | No errors |
| Unit tests pass | `pytest tests/unit/` | All green |
| Build profile works | `joyus-profile build --corpus ./fixtures/example/ --author Test --domain general --output /tmp/test-profile/` | Skill files created |
| Verify works | `joyus-profile verify --text ./fixtures/example/doc1.txt --profile /tmp/test-profile/ --tier 1` | Score returned |
| Regression accuracy | `pytest tests/regression/` | >=94.6% on 4-author, >=97.9% on 9-author |
| MCP server starts | `joyus-profile serve --stdio` | Ready message on stderr |
| Tier 1 latency | `pytest tests/integration/ -k latency` | <500ms per 1000 words |

## Common Issues

**"InsufficientCorpusError: 3 documents"**
- Minimum 5 documents per author. Provide more samples or accept a partial (lower confidence) profile.

**"spaCy model not found"**
- Run `python -m spacy download en_core_web_md`. For Tier 1-2 only, `en_core_web_sm` suffices.

**"Tier 1 check timeout"**
- Tier 1 should complete in <500ms. If slow, check that only top-20 function words are used (not full 129 features). Full features are Tier 2 only.

**"Low fidelity score on known-good text"**
- Check corpus size. Tier 4 accuracy requires 50K+ words. Smaller corpora produce Tier 1-2 profiles with lower discrimination.
- Verify the voice_key matches the audience (e.g., don't check litigator text against the educator voice).
