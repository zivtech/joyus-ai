# Internal AI Portal - Specification Draft

## Purpose
Define the internal web portal that provides mediated access to AI tooling for staff who cannot use local-first workflows.

## Scope
- Web-based chat and task interface.
- Organization-scoped authentication and authorization.
- Integration with platform MCP services.
- Skill-mediated operation and governance controls.

## Non-Goals
- Replacing local developer-native workflows for technical users.
- Building a generalized external customer portal in this phase.

## Baseline Requirements
1. Portal must provide authenticated access for approved internal users.
2. Portal must route actions through mediated platform services, not direct backend access.
3. Portal must preserve usage and governance auditability.
4. Portal must support skills and quality gates from the core platform.

## Dependencies
- MCP deployment readiness.
- Content infrastructure integration points.
- Governance policy definitions.
