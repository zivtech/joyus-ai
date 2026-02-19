# MCP Tools API Contract

**Server**: `joyus-profile-engine` MCP server (Python)
**Protocol**: Model Context Protocol (MCP)
**SDK**: `mcp` Python package

---

## Profile Tools

### `build_profile`

Build a writing profile from a document corpus.

**Input**:
```json
{
    "corpus_path": "/path/to/documents/",
    "author_name": "Author Name",
    "domain": "legal_advocacy",
    "output_dir": "/path/to/skills/author-001/",
    "formats": ["pdf", "docx", "md", "txt"]
}
```

**Output**:
```json
{
    "status": "success",
    "profile_id": "prof_abc123",
    "fidelity_tier": 4,
    "corpus_stats": {
        "documents": 22,
        "total_words": 85000,
        "avg_words_per_doc": 3864
    },
    "confidence": 0.92,
    "skill_files": [
        "SKILL.md",
        "markers.json",
        "stylometrics.json"
    ],
    "warnings": [],
    "duration_seconds": 142.5
}
```

### `get_profile`

Load and return a profile's metadata and summary.

**Input**:
```json
{
    "profile_dir": "/path/to/skills/author-001/"
}
```

**Output**:
```json
{
    "profile_id": "prof_abc123",
    "author_name": "Author Name",
    "domain": "legal_advocacy",
    "fidelity_tier": 4,
    "corpus_size": 22,
    "confidence": 0.92,
    "voice_contexts": ["litigator", "advocate", "educator", "expert"],
    "sections_summary": {
        "voice": "Formality 7/10, analytical with measured passion",
        "vocabulary": "127 signature phrases, 89 preferred terms, 52 avoided terms",
        "positions": "14 declared positions (3 high-strength)"
    }
}
```

### `compare_profiles`

Compare two profiles for similarity analysis.

**Input**:
```json
{
    "profile_a_dir": "/path/to/skills/author-001/",
    "profile_b_dir": "/path/to/skills/author-002/"
}
```

**Output**:
```json
{
    "overall_similarity": 0.34,
    "section_similarity": {
        "voice": 0.62,
        "vocabulary": 0.28,
        "structure": 0.45,
        "argumentation": 0.19,
        "citations": 0.41
    },
    "distinguishing_features": [
        "vocabulary.signature_phrases: 3% overlap",
        "argumentation.evidence_hierarchy: different ordering",
        "voice.formality: 7.2 vs 5.1"
    ]
}
```

---

## Verification Tools

### `verify_content`

Check generated content against a target profile.

**Input**:
```json
{
    "text": "The content to verify...",
    "profile_dir": "/path/to/skills/author-001/",
    "tier": "both",
    "voice_key": "advocate"
}
```

**Output**:
```json
{
    "tier1": {
        "score": 0.78,
        "passed": true,
        "marker_score": 0.82,
        "style_score": 0.72,
        "feedback": null
    },
    "tier2": {
        "score": 0.71,
        "passed": true,
        "burrows_delta": 0.94,
        "drift_detected": false,
        "feature_breakdown": {
            "function_words": 0.88,
            "sentence_length": 0.65,
            "vocabulary_richness": 0.79
        }
    },
    "overall_passed": true,
    "access_level": "public"
}
```

### `check_fidelity`

Quick fidelity check (Tier 1 only, <500ms).

**Input**:
```json
{
    "text": "The content to check...",
    "profile_dir": "/path/to/skills/author-001/",
    "voice_key": null
}
```

**Output**:
```json
{
    "score": 0.78,
    "passed": true,
    "feedback": null,
    "latency_ms": 87
}
```

---

## Attribution Tools (Phase B)

### `identify_author`

Identify the most likely author of a text using cascade attribution.

**Input**:
```json
{
    "text": "The text to attribute...",
    "hierarchy_dir": "/path/to/skills/",
    "explanation_tier": "pattern"
}
```

**Output**:
```json
{
    "match_level": "person",
    "candidates": [
        {
            "profile_id": "prof_abc123",
            "profile_type": "person",
            "author_name": "Author Name",
            "score": 0.91,
            "matched_markers": ["rent-a-bank scheme", "predatory lending"]
        },
        {
            "profile_id": "prof_def456",
            "profile_type": "person",
            "author_name": "Other Author",
            "score": 0.43
        }
    ],
    "explanation": "High confidence person-level match. Text matches Author Name's voice profile with 91% confidence. Key markers: 'rent-a-bank scheme' (high signal), 'predatory lending' (medium signal). Stylometric distance within expected range."
}
```

### `validate_attribution`

Verify that text matches a specified target.

**Input**:
```json
{
    "text": "The text to validate...",
    "target_id": "prof_abc123",
    "target_type": "person",
    "hierarchy_dir": "/path/to/skills/"
}
```

**Output**:
```json
{
    "matched": true,
    "confidence": 0.88,
    "explanation": "Text matches the specified author's voice profile.",
    "feature_breakdown": {
        "markers": 0.92,
        "stylometrics": 0.85,
        "vocabulary": 0.87
    }
}
```

### `detect_outsider`

Check if text comes from outside the organization.

**Input**:
```json
{
    "text": "The text to check...",
    "hierarchy_dir": "/path/to/skills/"
}
```

**Output**:
```json
{
    "is_outsider": true,
    "confidence": 0.94,
    "closest_match": {
        "profile_id": "dept_credit",
        "profile_type": "department",
        "score": 0.38
    },
    "explanation": "Text does not match any person, department, or organization profile. Closest match is the credit reporting department at 38% confidence (below 70% org threshold)."
}
```

---

## Monitoring Tools (Phase C)

### `check_drift`

Check for quality drift on a specific profile.

**Input**:
```json
{
    "profile_id": "prof_abc123",
    "data_dir": "/path/to/monitoring/",
    "window_days": 14
}
```

**Output**:
```json
{
    "drift_detected": true,
    "signals": [
        {
            "signal_type": "marker_shift",
            "severity": "medium",
            "description": "Signature phrase 'rent-a-bank scheme' usage dropped 28% over 14-day window",
            "current_value": 0.52,
            "baseline_value": 0.72
        }
    ],
    "diagnosis": {
        "probable_cause": "vocabulary_shift",
        "affected_features": ["vocabulary.signature_phrases"],
        "recommended_action": "update_markers",
        "description": "Marker list may need updating — new terminology entering domain"
    }
}
```

### `get_trends`

Get fidelity trends for a profile over time.

**Input**:
```json
{
    "profile_id": "prof_abc123",
    "data_dir": "/path/to/monitoring/",
    "window_days": 30,
    "granularity": "daily"
}
```

**Output**:
```json
{
    "profile_id": "prof_abc123",
    "window": {"start": "2026-01-20", "end": "2026-02-19"},
    "sample_count": 47,
    "trend": {
        "fidelity_mean": 0.81,
        "fidelity_std": 0.06,
        "fidelity_trend": -0.003,
        "daily_scores": [{"date": "2026-01-20", "mean": 0.84, "count": 2}]
    },
    "alerts": []
}
```

### `trigger_repair`

Propose or execute a repair action.

**Input**:
```json
{
    "diagnosis_id": "diag_xyz789",
    "action": "update_markers",
    "auto_apply": false
}
```

**Output**:
```json
{
    "action_id": "repair_uvw456",
    "status": "proposed",
    "description": "Add 3 new signature phrases, retire 1 obsolete marker",
    "changes": {
        "add_markers": ["fintech charter", "earned wage access", "bank-fintech partnership"],
        "retire_markers": ["payday lending rule"]
    },
    "requires_approval": true
}
```

---

## Error Responses

All tools return errors in a consistent format:

```json
{
    "error": "InsufficientCorpusError",
    "message": "Corpus contains 3 documents (minimum: 5). Profile quality will be degraded.",
    "details": {
        "document_count": 3,
        "minimum_required": 5,
        "word_count": 8500
    }
}
```

## Authentication

MCP tools inherit the platform's auth context. Voice access control (Layer 2) is enforced at the tool level — tools that return restricted voice data check the requesting user's access level against `VoiceAccessLevel`.
