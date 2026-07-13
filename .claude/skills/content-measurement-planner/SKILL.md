---
name: content-measurement-planner
description: "Design content measurement instruments — rubrics, coding schemes, reliability protocols for systematic quality evaluation."
version: 0.1.0
---

# Content Measurement Planner

Design measurement instruments before content scoring begins, so measurement is intentional rather than improvised.

## JTBD (Jobs To Be Done)

### Primary Job
When I need to systematically measure qualities of unstructured content and do not yet have a measurement protocol,
I want a rigorous instrument design that specifies what to measure, how to operationalize it, and how to validate the measurements,
so the results are trustworthy enough for decision-making.

### Secondary Jobs
- When I have bespoke scoring scripts and need to formalize them into a reusable measurement protocol.
- When I need to measure multiple constructs across a content corpus and want to avoid ad hoc prompt engineering.
- When `measurement-critic` found calibration or bias problems in an existing instrument, I want a redesign plan instead of vague "fix the prompts" instructions.

### This Skill Is For
- Content quality measurement at scale (knowledge bases, documentation, contributor profiles)
- Systematic evaluation of unstructured text against defined constructs
- Teams deciding which measurement type fits each construct (rate, rank, classify, extract, discover, codify, bucket)
- Formalizing ad hoc LLM scoring into calibrated, reproducible instruments
- Any project where measurement validity and reliability matter before acting on scores

### This Skill Is NOT For
- Reviewing an existing measurement instrument for validity; use `measurement-critic`
- Building eval suites for skills or agents; use `test-builder`
- Reviewing benchmark quality; use `test-critic`
- Generic content review or editing; use `copy-critic`
- Statistical analysis planning; use `study-design-planner`
- Data pipeline design; use `data-planner`

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|---|---|---|
| New content corpus needs systematic quality scoring | The planner defines constructs, operationalizes them with anchor examples, selects measurement types, and designs a calibration protocol | A measurement instrument spec ready for executor implementation |
| Existing bespoke scoring scripts need formalization | The planner reverse-engineers the implicit constructs, maps them to GABRIEL types, and adds calibration that was missing | A standardized instrument design that replaces ad hoc scripts |
| `measurement-critic` returned `REVISE` or `REJECT` | The planner converts the critic findings into construct redefinitions, recalibrated anchors, and bias mitigations | A redesigned instrument addressing the specific validity and reliability gaps |
| Scaling from one profile to many (catch-bot pattern) | The planner generalizes the bespoke methodology into a reusable protocol with per-entity parameterization | A standardized multi-entity measurement framework |

### When to Escalate
- If a measurement instrument already exists and the job is whether the measurements are valid, escalate to `measurement-critic`
- If the user needs eval-suite rigor for a skill rather than content measurement, escalate to `test-builder` or `test-critic`
- If the user needs statistical analysis of measurement results, escalate to `study-design-planner`

### Paired With
- `measurement-critic`: review the instrument after calibration or after measurement results raise concerns
- `content-measurement-executor` (planned): execute the instrument against content batches
- `test-builder`: generate a future benchmark suite for `content-measurement-planner` itself
- `test-critic`: validate that benchmark suite before relying on its claims

## Purpose

Most content measurement fails in one of two ways:
- It is too vague to produce consistent results (different prompts yield different scores for the same content).
- It measures what is easy to measure rather than what matters (proxy metrics instead of real constructs).

`content-measurement-planner` exists to prevent both. It starts from the constructs that matter, operationalizes them with concrete anchor examples, selects the right GABRIEL-derived measurement type for each, and designs a calibration protocol that catches bias and inconsistency before measurements are used for decisions.

## Reference Materials

- `references/measurement-types.md` — GABRIEL-derived measurement type taxonomy with selection guidance
- `references/calibration-guide.md` — inter-rater reliability methods, bias detection, and calibration protocols
- `examples/content-quality-measurement.md` — worked example: measuring knowledge base entry quality
