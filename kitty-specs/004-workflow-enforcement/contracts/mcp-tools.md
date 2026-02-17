# MCP Tool Contracts: Workflow Enforcement

**Feature**: 004-workflow-enforcement
**Date**: 2026-02-17

All tools are registered on the `jawn-ai-state` MCP server alongside existing 002 tools.

---

## run_gates

Run quality gates for a specified trigger point.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "trigger": {
      "type": "string",
      "enum": ["pre-commit", "pre-push"],
      "description": "The trigger point to run gates for"
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "If true, report which gates would run without executing them"
    }
  },
  "required": ["trigger"]
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "enforcementActive": { "type": "boolean" },
    "trigger": { "type": "string" },
    "gatesExecuted": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "gateId": { "type": "string" },
          "name": { "type": "string" },
          "type": { "type": "string" },
          "result": { "type": "string", "enum": ["pass", "fail", "timeout", "unavailable", "skipped", "bypassed"] },
          "duration": { "type": "number", "description": "Milliseconds" },
          "output": { "type": "string", "description": "Gate tool stdout/stderr (truncated)" },
          "enforcementTier": { "type": "string", "enum": ["always-run", "ask-me", "skip"] }
        }
      }
    },
    "overallResult": { "type": "string", "enum": ["pass", "fail", "bypassed", "disabled"] },
    "failedGate": { "type": "string", "description": "ID of first failed gate (fail-fast)" },
    "auditEntryIds": { "type": "array", "items": { "type": "string" } }
  }
}
```

**Behavior**:
- If kill switch is active, returns `overallResult: "disabled"` with no gate execution
- Executes gates in configured order (sequential fail-fast)
- Stops at first failure; remaining gates get `result: "skipped"`
- Enforcement tier (always-run/ask-me/skip) determined by user tier + gate config + overrides
- Each gate execution creates an audit entry

---

## get_skills

Query currently active skills and how each was loaded.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "Optional: check which skills would load for a specific file path"
    }
  }
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "activeSkills": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "source": { "type": "string", "enum": ["auto-loaded", "manually-loaded", "project-config"] },
          "precedence": { "type": "string" },
          "cachedFrom": { "type": "string", "description": "ISO8601, if loaded from cache" },
          "constraints": { "type": "string", "description": "Plain-language constraints for context injection" }
        }
      }
    },
    "conflictsResolved": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "winner": { "type": "string" },
          "loser": { "type": "string" },
          "reason": { "type": "string" }
        }
      }
    },
    "skillContext": {
      "type": "string",
      "description": "Combined plain-language constraints for all active skills (for context injection)"
    }
  }
}
```

---

## verify_branch

Verify current branch matches expected branch from task context.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["commit", "push", "merge"],
      "description": "The git operation about to be performed"
    }
  },
  "required": ["operation"]
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "currentBranch": { "type": "string" },
    "expectedBranch": { "type": "string", "description": "From task context, or null if not set" },
    "match": { "type": "boolean" },
    "enforcement": { "type": "string", "enum": ["block", "warn", "none"] },
    "namingValid": { "type": "boolean", "description": "Whether current branch matches naming convention" },
    "suggestedName": { "type": "string", "description": "Suggested branch name if naming is invalid" },
    "auditEntryId": { "type": "string" }
  }
}
```

**Behavior**:
- If no expected branch set in task context, returns `match: true` (no constraints invented)
- Enforcement level determined by user tier: Tier 1 = block, Tier 2 = warn, Tier 3 = block
- Also checks branch naming convention if configured

---

## check_hygiene

Check branch hygiene — stale branches, branch count, overall git health.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "staleBranches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "lastModified": { "type": "string" },
          "daysSinceModified": { "type": "number" }
        }
      }
    },
    "activeBranchCount": { "type": "number" },
    "branchLimit": { "type": "number" },
    "overLimit": { "type": "boolean" },
    "staleDaysThreshold": { "type": "number" }
  }
}
```

---

## check_upstream

Search project dependencies before implementing new code.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "What the user wants to implement (e.g., 'date formatting utility')"
    },
    "language": {
      "type": "string",
      "description": "Primary language of the project"
    }
  },
  "required": ["description"]
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "existingSolutions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "package": { "type": "string" },
          "relevantExport": { "type": "string" },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
          "reason": { "type": "string" }
        }
      }
    },
    "searchedIn": { "type": "array", "items": { "type": "string" }, "description": "What was searched (package.json, composer.json, etc.)" },
    "recommendation": { "type": "string", "enum": ["use-existing", "implement-new", "investigate-further"] }
  }
}
```

**Behavior**:
- Scans dependency manifests (package.json, composer.json, requirements.txt, Gemfile, etc.)
- Checks installed packages for exports matching the description
- Does NOT make network calls — searches local dependencies only

---

## query_audit

Query the audit trail with filters.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "timeRange": {
      "type": "object",
      "properties": {
        "from": { "type": "string", "description": "ISO8601" },
        "to": { "type": "string", "description": "ISO8601" }
      }
    },
    "actionType": { "type": "string", "description": "Filter by action type" },
    "skillId": { "type": "string", "description": "Filter by skill ID" },
    "taskId": { "type": "string", "description": "Filter by task/ticket ID" },
    "result": { "type": "string", "description": "Filter by result (pass, fail, bypassed, etc.)" },
    "limit": { "type": "number", "default": 50 },
    "offset": { "type": "number", "default": 0 }
  }
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "entries": { "type": "array", "items": { "$ref": "#/AuditEntry" } },
    "total": { "type": "number" },
    "hasMore": { "type": "boolean" }
  }
}
```

---

## record_correction

Capture a user correction when Claude's output didn't meet skill constraints.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "skillId": { "type": "string", "description": "Skill that should have prevented the issue" },
    "originalOutput": { "type": "string", "description": "What Claude produced" },
    "correctedOutput": { "type": "string", "description": "What the user corrected it to" },
    "explanation": { "type": "string", "description": "What was wrong" },
    "filePath": { "type": "string", "description": "File where the correction occurred" }
  },
  "required": ["skillId", "originalOutput", "correctedOutput"]
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "correctionId": { "type": "string" },
    "auditEntryId": { "type": "string" },
    "stored": { "type": "boolean" }
  }
}
```

---

## enforcement_status

Get current enforcement state — active gates, skills, tier, kill switch.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "enforcementActive": { "type": "boolean", "description": "false if kill switch is engaged" },
    "userTier": { "type": "string" },
    "configuredGates": { "type": "number" },
    "activeSkills": { "type": "number" },
    "skillMappings": { "type": "number" },
    "branchRulesConfigured": { "type": "boolean" },
    "auditStorageUsed": { "type": "string", "description": "Human-readable size (e.g., '12.3 MB')" },
    "auditStorageWarning": { "type": "boolean" },
    "companionServiceRunning": { "type": "boolean" },
    "killSwitchEngagedAt": { "type": "string", "description": "ISO8601, null if not engaged" }
  }
}
```

---

## kill_switch

Enable or disable all enforcement for the current session.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["disable", "enable"],
      "description": "Disable or re-enable enforcement"
    },
    "reason": {
      "type": "string",
      "description": "Why enforcement is being disabled (recorded in audit)"
    }
  },
  "required": ["action"]
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "enforcementActive": { "type": "boolean" },
    "auditEntryId": { "type": "string" },
    "message": { "type": "string" }
  }
}
```

**Behavior**:
- Session-scoped: new session restores enforcement to active
- The kill switch action itself is ALWAYS audited (audit logging cannot be disabled)
- Reason is optional but recorded if provided
