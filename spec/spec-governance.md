# Spec Governance — Kitty Pride

> How specifications are managed across the Joyus AI multi-repo ecosystem.

This document defines conventions for the **Kitty Pride** — a group of repos that each run Spec Kitty independently but follow shared standards for cross-repo coordination. These conventions are designed to be forward-compatible with Spec Kitty's planned multi-repo support.

---

## 1. Spec Classification

Every feature spec is classified at creation time. Do not write first and sanitize later.

| Classification | Location | Rules |
|---------------|----------|-------|
| `public-core` | `joyus-ai/kitty-specs/` | Must pass §2.10 — no client names, terminology, or identifying examples |
| `private-ops` | `joyus-ai-ops/kitty-specs/` | May reference cloud providers, deployment targets, infrastructure details |
| `private-internal` | `joyus-ai-internal/kitty-specs/` | Internal tooling; no client content |
| `private-client` | `<client>-skills/kitty-specs/` or `<client>-deploy/kitty-specs/` | Fully client-specific; isolated repo |

**Decision rule:** If a capability is described in terms of a specific client's domain, it is not yet ready for `public-core`. Generalize first, then spec it.

---

## 2. Feature Numbering

Each repo maintains its own independent feature number sequence (`001`, `002`, ...).

Cross-repo references use the format `repo_id#feature_number`:

```
joyus-ai#005        # Content Intelligence in the public core
joyus-ai-ops#001    # Infrastructure feature in the ops repo
acme-skills#003     # A skill feature in a client repo
```

There is no global numbering. The `repo_id` segment disambiguates.

---

## 3. Cross-Repo Dependencies

Dependencies between pride members are declared in `spec.md` frontmatter using the `pride_dependencies` field:

```yaml
---
id: "003"
title: "Compliance Skill Authoring"
pride_dependencies:
  - "joyus-ai#005"   # Content Intelligence (profile engine)
  - "joyus-ai#002"   # Session Context Management
---
```

**Semantics:**
- Dependencies are advisory. Spec Kitty ignores unknown frontmatter fields and will not error on this field.
- A dependency declaration means: "this feature assumes the referenced feature is complete and stable."
- Validation is handled by the `pride-status` script (see Section 4), not by Spec Kitty itself.
- Circular dependencies between repos are not permitted.

---

## 4. Pride Configuration

### 4.1 Per-Repo Identity

Each repo declares its identity in `.kittify/pride.yaml`:

```yaml
pride: joyus
repo_id: joyus-ai
visibility: public
feature_range: "001-099"
```

### 4.2 Local Registry

A local registry at `~/.config/kitty-pride/<pride-name>.yaml` maps `repo_id` to disk paths:

```yaml
pride: joyus
repos:
  joyus-ai:
    path: ~/claude/joyus-ai
    visibility: public
  joyus-ai-ops:
    path: ~/claude/joyus-ai-ops
    visibility: private
  joyus-ai-internal:
    path: ~/claude/joyus-ai-internal
    visibility: private
```

This file is machine-local and not committed to any repo.

### 4.3 The `pride-status` Script

The `pride-status` script (`scripts/pride-status.py`) reads the local registry, walks each registered repo's `kitty-specs/` directory, and produces a unified cross-repo feature status table. It also surfaces `pride_dependencies` declared in spec frontmatter.

```bash
python scripts/pride-status.py
python scripts/pride-status.py --registry ~/.config/kitty-pride/joyus.yaml
```

---

## 5. Lifecycle Rules

**At creation:**
- Assign classification before writing any spec content.
- `public-core` specs must use generic examples from the first sentence.
- `private-client` specs live in client-owned repos; never in this repo.

**During development:**
- Public features: all artifacts are public — spec, plan, tasks, WP prompts, fixtures, examples, tests.
- No private overlays or client-specific branches in the public repo.
- Private features that depend on public ones declare the dependency via `pride_dependencies`.

**At completion:**
- Accepted features remain in their repo's `kitty-specs/` directory as a permanent record.
- Do not delete or archive accepted specs; they document what the platform can do.

**Boundary rule:** If a spec, task, WP prompt, fixture, or comment in the public repo would allow a stranger to identify which client inspired it, it does not belong here. Move the client-specific content to a private repo and generalize what remains.

---

## 6. Repository Summary

| Repo | Visibility | Spec Kitty | Classification |
|------|-----------|------------|---------------|
| `joyus-ai` | Public | Yes | `public-core` |
| `joyus-ai-ops` | Private | Yes | `private-ops` |
| `joyus-ai-internal` | Private | Yes | `private-internal` |
| `<client>-skills` | Private (per client) | Yes | `private-client` |
| `<client>-deploy` | Private (per client) | Yes | `private-client` |

---

## 7. Future: Official Kitty Pride

These conventions are designed to be forward-compatible with Spec Kitty's planned multi-repo support. When the official feature ships:

- `pride.yaml` and `pride_dependencies` frontmatter will be natively recognized.
- The `pride-status` script will be replaced by a built-in `spec-kitty pride status` command.
- Migration path: existing `pride.yaml` files and frontmatter fields adopt the official schema with minimal changes.

Until then, this document is the authoritative source for cross-repo governance.

---

*Governed by constitution §2.10 "Client-Informed, Platform-Generic". All public spec content must abstract client needs into platform capabilities.*
