# Research: Platform Architecture Overview

## Purpose
Track architecture decisions and unresolved questions at umbrella level before domain-level implementation.

## R1: Layered Mediation Model
- Decision: Keep orchestration thin and domain layers thick.
- Rationale: Durable value sits in skills, verification, and governance.
- Downstream target: Domain features for workflow enforcement and content systems.

## R2: Multi-Backend Readiness
- Decision: Claude-first runtime with backend-agnostic interfaces.
- Rationale: Avoid lock-in while preserving shipping velocity.
- Downstream target: Domain-level backend abstraction spec.

## R3: Tenant and Compliance Boundaries
- Decision: Isolation and compliance constraints stay in core architecture contract.
- Rationale: Prevent feature-level bypass of security principles.
- Downstream target: Content and mediation infrastructure specs.

## R4: Governance Instrumentation
- Decision: Add governance checks as a first-class quality gate.
- Rationale: Prevent spec drift and documentation inconsistency at scale.
- Downstream target: Spec governance vNext stream.

## Open Items
1. Cost and usage dashboards: schema ownership model.
2. Service boundary between local and remote MCP systems.
3. Release policy for cross-domain breaking changes.
