# Quickstart: Workflow Enforcement

**Feature**: 004-workflow-enforcement
**Date**: 2026-02-17

## Prerequisites

- Feature 002 (`joyus-ai-state`) MCP server and companion service running
- Node.js 20+
- At least one quality gate tool installed (e.g., `eslint`, `vitest`)
- Skills repository cloned locally (e.g., `example-skills/`)

## Setup

### 1. Update joyus-ai-state

Workflow enforcement is built into `joyus-ai-state`. After updating:

```bash
cd joyus-ai-state
npm install    # installs better-sqlite3 for audit queries
npm run build
```

### 2. Configure Project Enforcement

Add enforcement config to your project's `.joyus-ai/config.json`:

```json
{
  "enforcement": {
    "gates": [
      {
        "id": "lint-eslint",
        "name": "ESLint",
        "type": "lint",
        "command": "npx eslint . --max-warnings 0",
        "triggerPoints": ["pre-commit", "pre-push"],
        "defaultTier": "always-run",
        "timeout": 60,
        "order": 1
      },
      {
        "id": "test-vitest",
        "name": "Unit Tests",
        "type": "test",
        "command": "npx vitest run",
        "triggerPoints": ["pre-push"],
        "defaultTier": "always-run",
        "timeout": 120,
        "order": 2
      }
    ],
    "skillMappings": [
      {
        "id": "drupal-modules",
        "filePatterns": ["*.module", "*.install", "*.theme"],
        "skills": ["drupal-coding-standards", "drupal-security"],
        "precedence": "core"
      }
    ],
    "branchRules": {
      "namingConvention": "^(feature|fix|hotfix|chore)/[a-z0-9-]+$",
      "staleDays": 14,
      "maxActiveBranches": 10,
      "protectedBranches": ["main", "master", "develop"]
    },
    "enforcementPolicy": {
      "mandatoryGates": ["lint-eslint"],
      "mandatorySkills": [],
      "tierOverridable": false
    }
  }
}
```

### 3. Configure Developer Tier

Add tier config to `~/.joyus-ai/projects/<project-hash>/config.json`:

```json
{
  "enforcement": {
    "tier": "tier-2",
    "gateOverrides": {
      "test-vitest": "ask-me"
    },
    "skillOverrides": {}
  }
}
```

### 4. Point to Skill Repository

Ensure the skill repository path is in your project config:

```json
{
  "skills": {
    "repoPath": "/path/to/example-skills",
    "cachePath": "~/.joyus-ai/projects/<hash>/skill-cache"
  }
}
```

## Usage

Once configured, enforcement is invisible. Claude handles everything:

- **Before pushing**: Claude calls `run_gates` → runs lint then tests → reports results
- **When editing Drupal files**: Skills auto-load → Claude follows Drupal standards
- **Before committing**: Claude calls `verify_branch` → checks you're on the right branch
- **At session start**: Companion service runs `check_hygiene` → Claude reports stale branches

### Emergency: Disable Enforcement

Ask Claude: "Disable enforcement for this session" → Claude calls `kill_switch(disable)`

### Check Status

Ask Claude: "What enforcement is active?" → Claude calls `enforcement_status`

### Query Audit

Ask Claude: "What happened in my last push?" → Claude calls `query_audit`

## Verification

After setup, verify enforcement works:

1. **Test gate execution**: Introduce a deliberate lint error, ask Claude to push → should be blocked
2. **Test skill loading**: Edit a `.module` file → ask Claude what skills are active → should show Drupal skills
3. **Test branch check**: Set expected branch in task context, switch to wrong branch, ask Claude to commit → should warn
4. **Test audit**: After running gates, ask Claude to query the audit trail → should show gate results
5. **Test kill switch**: Disable enforcement, re-run gate test → should proceed without gates
