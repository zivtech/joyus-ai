# Philosophy Runtime Contract

**Feature**: `005-content-intelligence`
**Family**: `profile_family=philosophy`
**Purpose**: First consumer contract for lens-first review/query/compare

---

## 1. Goal

Define how a consumer in Joyus should load and use philosophy-mode artifacts
without assuming they behave like voice-mode skill files.

This contract is intentionally reviewer-first. It does not define a general
generation surface.

## 2. Inputs

A philosophy consumer expects a profile directory containing:

- `philosophy-metadata.json`
- `philosophy-lenses.json`
- `positions.json`
- `evidence-map.json`
- optional `stewardship.json`
- optional `chronology.json`

If these are absent, the consumer must fail closed and report that philosophy
mode is unavailable.

## 3. Consumer Types

The first supported consumers are:

- **review**: "What objections would this profile family raise about this artifact?"
- **query**: "Which lens applies to this topic and why?"
- **compare**: "How do two philosophy profiles differ?"

No first-person author simulation is allowed in any philosophy consumer.

## 4. Review Consumer Contract

### Input

```json
{
  "mode": "review",
  "artifact_text": "string",
  "profile_dir": "/path/to/profile",
  "topics": ["cache_invalidation"],
  "subsystems": ["caching"]
}
```

### Output

```json
{
  "profile_family": "philosophy",
  "readiness_level": "debate_ready",
  "selected_lenses": [
    {
      "lens_id": "cache-correctness",
      "label": "Cache Correctness",
      "reason": "Matched canonical topics and supporting evidence."
    }
  ],
  "findings": [
    {
      "lens_id": "cache-correctness",
      "likely_objection": "The invariant is underspecified.",
      "approval_condition": "Name the invalidation contract explicitly."
    }
  ],
  "counter_lenses": [
    {
      "lens_id": "developer-experience-pragmatism",
      "reason": "Configured tension axis requires it."
    }
  ],
  "uncertainty": [
    "Evidence is weak on rollout/migration consequences."
  ]
}
```

## 5. Query Consumer Contract

The query consumer may summarize:

- strongest matching lenses
- likely concerns
- supporting evidence IDs
- uncertainty

It may not:

- speak in first person as the profiled author
- claim certainty beyond the readiness level
- invent counter-lenses or stewardship logic

## 6. Compare Consumer Contract

The compare consumer returns:

- where two profiles converge
- where they diverge
- which tension axes explain the divergence
- where evidence is weak

It should compare principles and constraints, not simulate a conversation.

## 7. Fail-Closed Rules

- `readiness_level=topical` => only topic/stance summary allowed
- missing `evidence-map.json` => no evidence-backed findings
- missing `tension_axes` => no counter-lens synthesis
- missing `stewardship.json` => no project/product arbiter layer

## 8. Verification

The consumer must be evaluated on:

- lens-selection accuracy
- counter-lens preservation
- approval-condition coverage
- uncertainty compliance
- stewardship-trigger correctness

It must not use stylometric similarity as its primary success metric.

## 9. Compatibility

- Existing voice-mode consumers keep using `SKILL.md + markers.json + stylometrics.json`
- Existing generation paths default to `profile_family=voice`
- Philosophy review/query/compare are additive consumers, not replacements for
  voice generation
