# Data Model: Org-Scale Agentic Governance

## Entities

### GovernanceDimension
- id: string
- name: string
- description: string
- maturity_score: int (0-3)
- severity: enum (P0, P1, P2)

### RemediationItem
- id: string
- epic: string
- priority: enum (P0, P1, P2)
- owner_role: string
- target_files: string[]
- acceptance_test: string
- due_date: date
- status: enum (open, in_progress, done)

### FeatureGovernanceMeta
- feature_number: string
- measurement_owner: string
- review_cadence: string
- risk_class: enum (low, platform, critical)
- lifecycle_state: enum (spec-only, planning, execution, done)

### GovernanceCheckResult
- check_id: string
- status: enum (pass, warn, fail)
- severity: enum (P0, P1, P2)
- target: string
- message: string
