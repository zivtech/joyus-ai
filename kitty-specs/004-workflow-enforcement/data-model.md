# Data Model: Workflow Enforcement

**Feature**: 004-workflow-enforcement
**Date**: 2026-02-17

## Entities

### QualityGate

A configurable check that runs at a defined trigger point.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique gate identifier (e.g., `lint-eslint`, `test-vitest`) |
| name | string | Human-readable name (e.g., "ESLint Linting") |
| type | GateType | `lint` \| `test` \| `a11y` \| `visual-regression` \| `custom` |
| command | string | Shell command to execute (e.g., `npx eslint .`) |
| triggerPoints | TriggerPoint[] | `pre-commit` \| `pre-push` |
| defaultTier | EnforcementTier | Default enforcement: `always-run` \| `ask-me` \| `skip` |
| timeout | number | Timeout in seconds (default: 60) |
| order | number | Execution order within trigger point (lower = first) |
| workingDir | string? | Optional working directory override |
| env | Record<string, string>? | Optional environment variables |

### SkillMapping

Associates file patterns with skills that should auto-load.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique mapping identifier |
| filePatterns | string[] | Glob patterns (e.g., `["*.module", "*.install"]`) |
| skills | string[] | Skill identifiers to load (e.g., `["drupal-coding-standards", "drupal-security"]`) |
| precedence | PrecedenceLevel | `client-override` \| `client-brand` \| `core` \| `platform-default` |

### Skill (runtime representation)

A loaded skill with constraints for Claude's context.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Skill identifier (matches skill repo filename) |
| name | string | Human-readable name |
| source | SkillSource | `auto-loaded` \| `manually-loaded` \| `project-config` |
| precedence | PrecedenceLevel | Precedence level for conflict resolution |
| constraints | string | Plain-language constraint text (injected into Claude's context) |
| antiPatterns | string[] | Patterns to check against in validation |
| validationCommand | string? | Optional validation command |
| loadedAt | ISO8601 | When this skill was loaded |
| cachedFrom | ISO8601? | If loaded from cache, when the cache was last refreshed |

### BranchRule

Project-level rules governing branch behavior.

| Field | Type | Description |
|-------|------|-------------|
| namingConvention | string? | Regex pattern for valid branch names (e.g., `^(feature|fix|hotfix)/[a-z0-9-]+$`) |
| staleDays | number | Days without modification before a branch is considered stale (default: 14) |
| maxActiveBranches | number | Warning threshold for active branch count (default: 10) |
| protectedBranches | string[] | Branches that cannot be force-pushed (default: `["main", "master"]`) |

### AuditEntry

A timestamped record of an enforcement action.

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID v4 |
| timestamp | ISO8601 | When the action occurred |
| sessionId | string | Session identifier (from 002 state) |
| actionType | AuditActionType | See enum below |
| result | AuditResult | `pass` \| `fail` \| `skip` \| `timeout` \| `unavailable` \| `bypassed` |
| userTier | UserTier | `tier-1` \| `tier-2` \| `tier-3` |
| activeSkills | string[] | Skills active at time of action |
| taskId | string? | Linked task/ticket ID (e.g., `PROJ-142`) |
| gateId | string? | Quality gate ID (for gate actions) |
| skillId | string? | Skill ID (for skill actions) |
| details | Record<string, unknown> | Action-specific details (gate output, override reason, etc.) |
| overrideReason | string? | If bypassed, the user's stated reason |
| branchName | string? | Current branch at time of action |

### AuditActionType (enum)

```
gate-execution        # Quality gate ran
gate-bypass           # Quality gate bypassed by user
skill-load            # Skill auto-loaded
skill-bypass          # Skill bypassed by power user
branch-verify         # Branch verification check
branch-mismatch       # Branch mismatch detected
branch-hygiene        # Stale branch / count warning
naming-violation      # Branch naming convention violation
force-push-warning    # Force push attempt detected
uncommitted-warning   # Uncommitted changes detected before branch switch
kill-switch-on        # Enforcement disabled
kill-switch-off       # Enforcement re-enabled
correction-captured   # User correction recorded
upstream-check        # "Check upstream" prompt fired
config-reload         # Config reloaded (branch switch, manual)
```

### Correction

A captured instance of user correction.

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID v4 |
| timestamp | ISO8601 | When the correction was captured |
| sessionId | string | Session identifier |
| skillId | string | Skill that should have prevented the issue |
| originalOutput | string | What Claude produced (truncated to relevant section) |
| correctedOutput | string | What the user corrected it to |
| explanation | string? | User's explanation of what was wrong |
| filePath | string? | File where the correction occurred |

### EnforcementConfig (project-level)

```
{
  "enforcement": {
    "gates": QualityGate[],
    "skillMappings": SkillMapping[],
    "branchRules": BranchRule,
    "enforcementPolicy": {
      "mandatoryGates": string[],     // gate IDs that cannot be overridden
      "mandatorySkills": string[],    // skill IDs that cannot be bypassed
      "tierOverridable": boolean      // whether developer can change their own tier
    }
  }
}
```

### DeveloperConfig (per-developer)

```
{
  "enforcement": {
    "tier": UserTier,
    "gateOverrides": {
      [gateId: string]: EnforcementTier   // per-gate tier override
    },
    "skillOverrides": {
      [skillId: string]: "enabled" | "disabled"
    }
  }
}
```

## Relationships

```
EnforcementConfig (project)
  ├── has many → QualityGate
  ├── has many → SkillMapping
  │                 └── references many → Skill (from skill repo)
  └── has one → BranchRule

DeveloperConfig (per-developer)
  └── overrides → EnforcementConfig (where policy permits)

AuditEntry
  ├── references → QualityGate (optional, for gate actions)
  ├── references → Skill (optional, for skill actions)
  ├── references → Session (from 002)
  └── references → Task/Ticket (optional, from session context)

Correction
  ├── references → Skill
  └── references → Session (from 002)
```

## State Transitions

### Quality Gate Lifecycle

```
PENDING → RUNNING → PASSED
                  → FAILED
                  → TIMED_OUT
                  → UNAVAILABLE (tool not installed)
          SKIPPED (fail-fast: prior gate failed)
          BYPASSED (user override, Tier 2 only for non-mandatory gates)
```

### Kill Switch

```
ACTIVE (enforcement on) → DISABLED (kill switch engaged)
                        ← ACTIVE (kill switch disengaged or new session)
```

### Skill Loading

```
NOT_LOADED → LOADING → LOADED (fresh from repo)
                     → LOADED_CACHED (repo unreachable, using cache)
                     → LOAD_FAILED (no cache available)
           → BYPASSED (power user override)
```
