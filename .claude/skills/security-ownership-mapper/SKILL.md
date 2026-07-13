---
name: security-ownership-mapper
description: Analyze git history to map code ownership, compute bus factors, and identify orphaned security-sensitive code
triggers:
  - ownership map
  - bus factor
  - code ownership
  - orphaned code
  - who owns
version: 0.1.0
---

# Security Ownership Mapper

## When to Use
Use when you need to understand code ownership patterns and identify security-sensitive code that lacks adequate maintainer coverage. Best for surfacing organizational risk before it becomes a security incident.

## What It Does
Analyzes git history to produce:
- Bus factor per directory/module
- Sensitive file ownership inventory
- Orphaned code detection
- Contributor departure risk
- Prioritized knowledge transfer recommendations

## Invocation
```
/security-ownership-mapper
```

## Input
Provide:
1. Repository path (defaults to current directory)
2. History window (defaults to 12 months)
3. Path filters (optional, for monorepos)
4. Sensitivity patterns (optional, has sensible defaults)

Optionally accepts security-threat-model-planner output for trust boundary context.

## Output
- Executive summary with top 5 risks
- Bus factor analysis table
- Sensitive file ownership inventory
- Orphaned code inventory
- Contributor risk assessment
- Prioritized recommendations

## Companion Skills
- **security-threat-model-planner** (upstream) — provides trust boundaries and asset classification
- **proposal-critic** (downstream) — reviews risk prioritization and recommendations
