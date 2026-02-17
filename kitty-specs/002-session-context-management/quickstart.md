# Quickstart: Session & Context Management

**Feature**: 002-session-context-management
**Date**: 2026-02-16
**Revised**: 2026-02-16 (MCP-first architecture)

---

## Prerequisites

- Node.js 20+
- Git (any recent version)
- Claude Desktop or Claude Code
- A project with a git repository

---

## Setup (End Users — Tier 1/3)

Maximum effort: add the MCP server to Claude + run the companion service.

### Step 1: Add MCP Server to Claude

Add jawn-ai to your Claude Desktop or Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "jawn-ai-state": {
      "command": "npx",
      "args": ["jawn-ai-mcp"]
    }
  }
}
```

### Step 2: Start the Companion Service

```bash
# Run the companion service (background state capture)
npx jawn-ai-service
```

The companion service watches for significant events (git commits, branch switches, test runs) and captures state snapshots automatically.

### Step 3: Done

That's it. Claude now has access to jawn-ai tools and will use them automatically:

- **Session start**: Claude calls `get_context` and tells you where you left off
- **During work**: Claude calls `save_state` after significant actions
- **Before risky actions**: Claude calls `verify_action` to catch mistakes
- **Document references**: Claude calls `check_canonical` to route to the right file
- **Sharing context**: Claude calls `share_state` when you need help from a teammate

You never run jawn-ai commands. Claude handles everything.

---

## How It Works (User's Perspective)

### Resuming After a Session Break

```
You: "continue"

Claude: "I can see where you left off. You were on branch feature/a11y-652
with 3 modified files. Your last test run showed 12 passing and 2 failing
(FilterPipeSeparatorsTest::testMobileNav, ThemeA11yTest::testAriaLabels).
You had an open decision about whether mobile nav should use accordion
or dropdown. Want me to pick up from there?"
```

### Getting a Branch Warning

```
You: "commit this"

Claude: "Hold on — you're on the main branch, but your last work was on
feature/a11y-652. Did you mean to switch branches first?"
```

### Sharing Context for Help

```
You: "I'm stuck, can you share my context with Alex?"

Claude: "I've exported your current state with a note about the failing
filter tests. Alex can load it in their session to see exactly where
you are."
```

---

## Setup (Power Users — Tier 2)

Power users can optionally install Claude Code hooks for tighter integration and use the admin CLI for direct state inspection.

### Optional: Claude Code Hooks

Hooks provide tighter event capture integration (the companion service handles this by default, but hooks are more immediate):

Add to `.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "type": "command", "command": "jawn-ai snapshot --event=session-start --quiet" }
    ],
    "Stop": [
      { "type": "command", "command": "jawn-ai snapshot --event=session-end --quiet" }
    ]
  }
}
```

### Optional: Admin CLI

```bash
# Install the CLI globally
cd jawn-ai-state
npm install && npm run build && npm link

# Initialize a project
cd ~/my-project
jawn-ai config init

# Manual operations
jawn-ai snapshot                    # Capture state now
jawn-ai restore                    # Show last state
jawn-ai status                     # Show live context
jawn-ai canonical list             # List canonical docs
jawn-ai share --note "need help"   # Share state
```

---

## Verification

After setup, verify everything works:

1. **Start a Claude session** in a git project with the MCP server configured
2. **Ask Claude**: "What's my current context?" — Claude should call `get_context` and describe your branch, modified files, etc.
3. **Make a git commit** — the companion service captures a snapshot automatically
4. **Start a new session** and say "continue" — Claude should restore your context from the snapshot
5. **Ask Claude to check a file**: "Is docs/todo.md the canonical source?" — Claude should call `check_canonical`

---

## Configuration

Configuration is managed via `.jawn-ai/config.json` in the project root or `~/.jawn-ai/global-config.json` for user-wide defaults.

```json
{
  "autoRestore": true,
  "eventTriggers": {
    "commit": true,
    "branchSwitch": true,
    "testRun": true,
    "fileChange": false
  },
  "verbosity": "normal"
}
```

Power users can modify config via the admin CLI (`jawn-ai config set <key> <value>`) or by editing the JSON directly.
