# Spec Governance - Kitty Pride (vNext)

> How specifications are managed across the Joyus AI multi-repo ecosystem.

This document defines conventions for the Kitty Pride - a group of repos that each run Spec Kitty independently but follow shared standards for cross-repo coordination.

---

## 1. Spec Classification

Every feature spec is classified at creation time.

| Classification | Location | Rules |
|---|---|---|
| `public-core` | `joyus-ai/kitty-specs/` | Must satisfy constitution client-abstraction rules |
| `private-ops` | `joyus-ai-ops/kitty-specs/` | May include infrastructure deployment specifics |
| `private-internal` | `joyus-ai-internal/kitty-specs/` | Internal tooling and process docs |
| `private-client` | `<client>-skills/kitty-specs/` or `<client>-deploy/kitty-specs/` | Fully client-specific, isolated repo |

Decision rule: if a capability is described in terms of a specific client domain, it is not ready for `public-core`.

---

## 2. Feature Numbering

Each repo maintains its own feature sequence (`001`, `002`, ...).

Cross-repo references use `repo_id#feature_number`:

```text
joyus-ai#005
joyus-ai-ops#001
acme-skills#003
```

---

## 3. Cross-Repo Dependencies

Dependencies between pride members are declared in `spec.md` frontmatter using `pride_dependencies`.

```yaml
---
id: "003"
title: "Compliance Skill Authoring"
pride_dependencies:
  - "joyus-ai#005"
  - "joyus-ai#002"
---
```

Semantics:
- Dependency declaration means the referenced feature is assumed complete and stable.
- Validation is performed by governance checks and pride status tooling.
- Circular dependencies are not permitted.

---

## 4. Pride Configuration

### 4.1 Per-Repo Identity

Each repo declares identity in `.kittify/pride.yaml`.

### 4.2 Local Registry

Machine-local registry at `~/.config/kitty-pride/<pride-name>.yaml` maps `repo_id` to paths.

### 4.3 Pride Status Script

`python scripts/pride-status.py --registry ~/.config/kitty-pride/joyus.yaml`

The script reports:
- feature status
- work package progress
- artifact integrity signals
- metadata completeness signals
- constitution sync flag

---

## 5. Lifecycle and Required Artifacts

### 5.1 Lifecycle States

Lifecycle state is declared in each feature `meta.json` via `lifecycle_state`:
- `spec-only`
- `planning`
- `execution`
- `done`

### 5.2 Required Artifact Matrix

| Lifecycle | Required Artifacts |
|---|---|
| `spec-only` | `spec.md`, `meta.json`, `checklists/requirements.md` |
| `planning` | `spec.md`, `meta.json`, `checklists/requirements.md`, `plan.md`, `tasks.md`, `research.md` |
| `execution` | `spec.md`, `meta.json`, `checklists/requirements.md`, `plan.md`, `tasks.md`, `research.md` |
| `done` | `spec.md`, `meta.json`, `checklists/requirements.md`, `plan.md`, `tasks.md`, `research.md` |

Notes:
- `data-model.md`, `quickstart.md`, and `contracts/` are strongly recommended for implementation features.
- Missing required artifacts are P0 for `execution` and `done`, P1 for `planning`, and P1 for `spec-only`.

---

## 6. Metadata Contract

Each feature `meta.json` must include:
- `feature_number`
- `slug`
- `friendly_name`
- `mission`
- `created_at`
- `measurement_owner`
- `review_cadence`
- `risk_class`
- `lifecycle_state`

Definitions:
- `measurement_owner`: owner role for KPI and ROI tracking.
- `review_cadence`: expected governance review cadence (for example `weekly`, `biweekly`, `monthly`).
- `risk_class`: one of `low`, `platform`, `critical`.

---

## 7. Platform-Level Spec Contract

For features where `risk_class` is `platform` or `critical`, `spec.md` must include sections:
1. `Adoption Plan`
2. `ROI Metrics`
3. `Security + MCP Governance`

Legacy features created before this vNext freeze may be reported as warnings until explicitly upgraded.

---

## 8. Validation Gates

Governance checks run through `scripts/spec-governance-check.py` and should run in CI.

Required checks:
1. Artifact completeness by lifecycle state.
2. Broken local markdown references.
3. Constitution drift between `spec/constitution.md` and `.kittify/memory/constitution.md`.
4. Checklist/spec consistency for "no implementation details" claims.
5. Platform-level section contract for new platform/critical features.
6. Metadata contract completeness.

Severity model:
- P0: merge-blocking governance failures.
- P1: must-fix governance debt.
- P2: improvement backlog.

---

## 9. Source-of-Truth Freshness

`README.md`, `ROADMAP.md`, and current pride status must stay aligned.

Minimum rule:
- If `python scripts/pride-status.py` output materially changes feature state, public status tables are updated in the same change window.

---

## 10. Repository Summary

| Repo | Visibility | Spec Kitty | Classification |
|---|---|---|---|
| `joyus-ai` | Public | Yes | `public-core` |
| `joyus-ai-ops` | Private | Yes | `private-ops` |
| `joyus-ai-internal` | Private | Yes | `private-internal` |
| `<client>-skills` | Private | Yes | `private-client` |
| `<client>-deploy` | Private | Yes | `private-client` |

---

## 11. vNext Freeze

vNext governance baseline established: **2026-02-23**.

This freeze introduces:
- lifecycle-based artifact contract
- metadata contract (`measurement_owner`, `review_cadence`, `risk_class`, `lifecycle_state`)
- platform-level section contract
- automated governance checks and CI gating

---

## 12. Future: Official Kitty Pride

When official multi-repo support ships in Spec Kitty:
- adopt native pride schemas
- map current metadata keys to official equivalents
- retire custom compatibility wrappers only after parity is confirmed

---

Governed by constitution principle: all public spec content must abstract client needs into platform capabilities.
