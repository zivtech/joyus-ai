# Hosting Comparison - Joyus AI Platform

## Purpose
This document captures the current hosting decision context referenced by `spec/plan.md`.

## Decision Snapshot
- Selected near-term hosting model: AWS EC2 plus Docker Compose.
- Primary rationale: mature MCP ecosystem support and low monthly cost for initial deployment.

## Evaluated Options

| Option | Strengths | Risks | Current Decision |
|---|---|---|---|
| AWS EC2 + Docker Compose | Full control, low cost, mature MCP support | More operational ownership | Selected |
| Managed app platform | Lower ops burden | Less control over custom runtime needs | Deferred |
| Multi-cloud baseline | Portability | Higher initial complexity | Deferred |

## Revisit Triggers
- Sustained production load that exceeds single-node deployment assumptions.
- Compliance requirements that require stronger managed controls.
- Team capacity constraints for VM operations.
