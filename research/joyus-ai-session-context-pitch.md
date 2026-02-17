# joyus-ai: Session & Context Management

**Your AI coding agents forget. joyus-ai remembers.**

---

## The Problem Every AI-Assisted Team Hits

AI coding assistants are powerful, but they share a critical weakness: they lose track of what you were doing. Sessions compact, connections drop, laptops close. When the next session starts, your developer is back to square one, re-explaining their branch, their progress, their decisions.

This is not a minor inconvenience. In production use across real client projects, we have seen:

- **8,000+ word continuation summaries** that still miss key details after a session restart
- **Wrong-branch commits** because the AI lost track of which branch was active
- **Cherry-pick chains** to recover from context-loss mistakes, each one introducing new risk
- **Document divergence** where the same file exists in two locations with different content, and nobody knows which version is correct
- **20-minute troubleshooting delays** while a junior developer tries to explain their full working state to a senior teammate

These problems get worse with scale. More developers, more branches, more sessions, more opportunities for context to fall through the cracks.

## What joyus-ai Does

joyus-ai is a mediator layer that sits between your developers and their AI coding agents. The Session & Context Management capability captures, preserves, and restores working context automatically, so no session starts from scratch.

### Automatic State Capture

joyus-ai captures structured snapshots of developer working context on significant events: git commits, branch switches, test runs, and session boundaries. Each snapshot records the current branch, modified files, test results, pending decisions, and active task. Snapshots are event-driven, not continuous, keeping overhead under 100 milliseconds per capture.

### Seamless Session Restoration

When a new AI session starts, joyus-ai presents a complete summary of where the developer left off. Branch, modified files, last test results, unresolved decisions. The developer says "continue" and picks up exactly where they stopped. No re-explaining. No guessing.

### Canonical Document Declarations

Teams declare which copy of a shared document is the authoritative source. When anyone references "the tracking spreadsheet" or "the audit report," joyus-ai routes to the declared canonical version and warns if a stale copy is accessed. This eliminates the silent data loss that happens when two versions of a file drift apart.

### Context Sharing for Troubleshooting

A developer who is stuck can share their full working context with a teammate in one command. The shared state includes everything: branch, modified files, test results, pending decisions, and a note describing what they were trying to do. The teammate loads that context into their own session and can diagnose the problem immediately, without a lengthy back-and-forth about "what were you working on?"

### Agent-Agnostic Architecture

joyus-ai works with Claude Code today through a native hook integration. An adapter pattern makes the same capabilities available to Codex, OpenClaw, and web-based AI tools. Teams are not locked into a single platform, and context persists even when switching between agents.

## How It Works

```
Developer works in AI session
        |
  Significant event occurs (commit, branch switch, test run)
        |
  joyus-ai captures structured snapshot (<100ms, non-blocking)
        |
  Session ends (clean exit, compaction, or crash)
        |
  New session starts
        |
  joyus-ai restores full context automatically
        |
  Developer continues without interruption
```

State is stored locally per developer, never leaves their machine by default, and survives dirty exits because snapshots are captured at events rather than only at clean shutdown. If a session crashes, the most recent snapshot reflects the last significant action, not an empty slate.

## Who This Is For

- **Development teams using AI coding assistants** who lose time to session restarts and context re-explanation
- **Organizations with junior developers** where context loss leads to wrong-branch commits and recovery overhead
- **Teams with shared reference documents** that suffer from version divergence across branches and working directories
- **Technical leads** who spend time diagnosing problems that a developer cannot fully explain because they have lost their own context

## Why It Matters

The cost of context loss is not dramatic. It is cumulative. Five minutes here re-explaining a branch. Ten minutes there recovering from a wrong commit. Twenty minutes of back-and-forth when a junior developer needs help. Across a team, across weeks, it adds up to a meaningful drag on velocity and quality.

joyus-ai eliminates that drag. Not by changing how your team works, but by making sure the AI remembers what your team was doing.

---

**Built by [Zivtech](https://www.zivtech.com)** | TypeScript/Node.js | Works offline | Open to any AI coding platform

*joyus-ai Session & Context Management is Spec 1 of the joyus-ai mediator platform. Workflow Enforcement and Observability capabilities follow.*
