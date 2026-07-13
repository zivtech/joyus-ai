---
name: content-measurement-executor
description: Apply GABRIEL-derived measurement instruments to content batches with per-item audit trails
triggers:
  - measure content
  - apply rubric
  - score items
  - content scoring
  - measurement execution
version: 0.1.0
---

# Content Measurement Executor

## When to Use
Use when you have a content-measurement-planner spec (or a direct rubric) and need to apply it to a batch of content items. Produces scored results with full audit trails.

## What It Does
Applies one of 7 GABRIEL-derived measurement types to content batches:
- **Rate** — score on a rubric scale
- **Rank** — order by construct
- **Classify** — assign categories
- **Extract** — pull specific information
- **Discover** — identify emergent patterns
- **Codify** — apply coding scheme
- **Bucket** — group by similarity

Each item gets a full audit record (prompt, response, extracted score, confidence).

## Invocation
```
/content-measurement-executor
```

## Input
Provide:
1. Measurement spec from content-measurement-planner (or direct rubric + construct definition)
2. Content batch (items to measure)
3. Calibration samples (optional, recommended)
4. Output format preference (JSON/CSV)

## Output
- Batch statistics (distribution, mean/SD)
- Calibration report (if calibration samples provided)
- Structured measurement results (JSON/CSV)
- Per-item audit trail
- Deviation log

## Companion Skills
- **content-measurement-planner** (upstream) — designs the measurement instrument
- **measurement-critic** (downstream) — validates measurement quality
