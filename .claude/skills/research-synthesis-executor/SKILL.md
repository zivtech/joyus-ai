---
name: research-synthesis-executor
description: Generate structured research syntheses from lit-review-planner specs — 4 output formats with structured citations
triggers:
  - synthesize research
  - research synthesis
  - literature synthesis
  - evidence summary
version: 0.1.0
---

# Research Synthesis Executor

## When to Use
Use when you have a lit-review-planner spec (or a direct set of research sources) and need a structured synthesis document generated. Consumes planner output and produces one of 4 synthesis formats.

## What It Does
Generates research synthesis documents with:
- Source inventory with quality classification
- Thematic synthesis (not source-by-source summaries)
- Structured citations (author, year, title, DOI)
- Explicit treatment of conflicting evidence
- Deviation log for spec gaps

## Invocation
```
/research-synthesis-executor
```

## Input
Provide one of:
1. lit-review-planner output (preferred)
2. Direct input: source list + research question + desired format

## Output Formats
- **Quick brief** — 1 page, key findings + implications
- **Research summary** — 2-3 pages, thematic synthesis
- **Comparison matrix** — Tabular source comparison
- **Comprehensive report** — 5+ pages with methodology and evidence quality

## Companion Skills
- **lit-review-planner** (upstream) — designs the review protocol this executor consumes
- **research-critic** (downstream) — reviews the synthesis for citation integrity and balance
