# Skills Marketplace — Architecture

**Extends:** [PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md)
**Date:** February 10, 2026
**Status:** Design

---

## Problem

The platform has two user populations that need access to curated AI skills:

1. **Mac devs** — Running Claude Code natively in terminal. Can use the native plugin marketplace, `npx skills add`, etc.
2. **Windows users** — No local Claude Code. Connecting remotely to the platform server via Claude Desktop (remote MCP) or a web interface.

Skills like `audit-website` (SquirrelScan) require CLI tools installed somewhere. For Windows users, that "somewhere" is the platform server, not their local machine.

Additionally, PMs and non-dev team members need a way to **discover and request skills** that a dev then reviews and approves before the skill becomes available team-wide.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SKILL DISTRIBUTION LAYER                               │
│                                                                                  │
│   ┌────────────────────────────────────────────────────────────────────────┐     │
│   │              GitHub: <org>/skills                             │     │
│   │              (Plugin Marketplace Repository)                           │     │
│   │                                                                        │     │
│   │   .claude-plugin/marketplace.json   ◄── Catalog of approved skills    │     │
│   │   plugins/                                                             │     │
│   │   ├── audit-website/                ◄── SquirrelScan integration      │     │
│   │   ├── org-jira/                 ◄── Jira workflows + templates    │     │
│   │   ├── org-confluence/           ◄── Confluence read/write         │     │
│   │   ├── org-ticket-writing/       ◄── Ticket standards skill        │     │
│   │   └── ...                                                              │     │
│   │                                                                        │     │
│   │   PR WORKFLOW:                                                         │     │
│   │   PM opens PR → Dev reviews → Merge = approved → Auto-deployed        │     │
│   └────────────────────────────────────────────────────────────────────────┘     │
│                    │                                    │                         │
│        ┌───────────┘                                    └───────────┐            │
│        ▼                                                            ▼            │
│  ┌─────────────────────┐                              ┌─────────────────────┐   │
│  │  MAC DEVS           │                              │  WINDOWS USERS      │   │
│  │  (Claude Code CLI)  │                              │  (Remote Access)    │   │
│  │                     │                              │                     │   │
│  │  /plugin marketplace│                              │  Claude Desktop     │   │
│  │    add <org>/       │                              │  → MCP Server       │   │
│  │    claude-skills    │                              │  → org_skills   │   │
│  │                     │                              │    tool             │   │
│  │  /plugin install    │                              │                     │   │
│  │    audit-website@   │                              │  OR                 │   │
│  │    org-skills   │                              │                     │   │
│  │                     │                              │  Web UI             │   │
│  │  Skills run locally │                              │  → ai.example.com  │   │
│  │  (squirrel CLI on   │                              │  → Skills run on    │   │
│  │   their machine)    │                              │    server           │   │
│  └─────────────────────┘                              └─────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Two Delivery Channels, One Source of Truth

The GitHub repo `<org>/skills` is the single source of truth for all approved skills. It serves two audiences through two mechanisms:

### Channel 1: Native Claude Code (Mac Devs)

Uses the official Claude Code plugin marketplace system. The repo contains a `marketplace.json` that lists all skills as installable plugins. Devs register it once:

```bash
/plugin marketplace add <org>/skills
```

Then browse and install:

```bash
/plugin install audit-website@org-skills
```

Skills run locally — SquirrelScan CLI gets installed on their Mac, Jira/Confluence integrations use their own OAuth tokens or the shared MCP server.

### Channel 2: Remote MCP (Windows Users)

The Joyus AI MCP Server reads from the same GitHub repo and exposes two things:

1. **A `org_skills` MCP tool** — Lists available skills, shows descriptions, lets users enable/disable skills for their session. When a Windows user types something like "show me available skills" or "audit this website," Claude sees the tool and knows what's available.

2. **Server-side skill execution** — Skills that require CLI tools (like SquirrelScan) run on the server. The MCP server has those tools installed and executes them on behalf of the user.

---

## The `org_skills` MCP Tool

When Windows users connect Claude Desktop to the platform MCP server, they get a tool that lets them interact with the skills catalog:

```typescript
// Tool definition exposed via MCP
{
  name: "org_skills",
  description: "Browse and manage the curated AI skill catalog. " +
    "Use 'list' to see available skills, 'info <skill>' for details, " +
    "or 'enable <skill>' to activate a skill for your session.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "info", "enable", "disable", "request"],
        description: "Action to perform"
      },
      skill: {
        type: "string",
        description: "Skill name (for info/enable/disable/request)"
      },
      reason: {
        type: "string",
        description: "Reason for requesting a new skill (for request action)"
      }
    },
    required: ["action"]
  }
}
```

### What Each Action Does

| Action | Description | Example User Prompt |
|--------|-------------|---------------------|
| `list` | Shows all available skills with descriptions | "What skills are available?" |
| `info` | Shows full details for a skill including what it does, requirements, and examples | "Tell me about the audit-website skill" |
| `enable` | Activates a skill's tools for this session | "Enable the site audit skill" |
| `disable` | Deactivates a skill's tools | "Disable the audit skill" |
| `request` | Opens a GitHub PR requesting a new skill (or creates a draft for the PM) | "I want to request a new skill for PDF form filling" |

### How Claude Discovers Skills

When Claude Desktop connects, the MCP server's `tools/list` response includes `org_skills` as one of the available tools. Claude's description tells it what the tool does, so when a user asks about available skills or wants to audit a website, Claude knows to use this tool.

This means there's no special skill command — instead, users just talk naturally:

- "What skills are available?" → Claude calls `org_skills` with `action: "list"`
- "Audit our website" → Claude recognizes this matches the `audit-website` skill, enables it, then runs the audit
- "I need a skill that can do X" → Claude calls `org_skills` with `action: "request"`

---

## Skill Types

Not all skills work the same way when delivered remotely. The marketplace categorizes skills by their execution model:

### Type 1: Knowledge Skills (Prompt-Only)

Skills that only add instructions/context to Claude's prompt. These work identically in both channels — the SKILL.md content gets injected into the conversation.

**Examples:** `org-ticket-writing`, `org-writing-style`, `drupal-coding-standards`

**Remote delivery:** MCP server loads the SKILL.md content and returns it as context when the skill is enabled. Claude uses the instructions for the rest of the session.

### Type 2: Tool Skills (CLI Required)

Skills that require executing external tools/CLIs. For Mac devs, these run locally. For Windows users, they run on the server.

**Examples:** `audit-website` (SquirrelScan), `lighthouse-audit`, `pa11y-accessibility`

**Remote delivery:** MCP server has the CLI tools installed. When the skill is enabled, the server exposes additional MCP tools specific to that skill (e.g., `squirrelscan_audit`, `squirrelscan_report`). The server runs the CLI and returns results.

### Type 3: Integration Skills (API-Based)

Skills that connect to external APIs. The MCP server handles OAuth and credentials centrally.

**Examples:** `org-jira`, `org-confluence`, `org-slack`

**Remote delivery:** Already handled by the existing MCP tool layer. The skill adds knowledge about organization-specific workflows (JQL patterns, Confluence space conventions, etc.) on top of the raw API tools.

### Type 4: Hybrid Skills

Skills that combine knowledge + tools. Example: `audit-website` is both a knowledge skill (telling Claude how to interpret audit results and prioritize fixes) and a tool skill (running SquirrelScan CLI).

---

## GitHub Repository Structure

```
<org>/skills/
├── .claude-plugin/
│   └── marketplace.json            # Plugin marketplace catalog
├── plugins/
│   ├── audit-website/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── skills/
│   │   │   └── audit-website/
│   │   │       ├── SKILL.md        # Instructions for Claude
│   │   │       └── examples/
│   │   │           └── sample-audit.md
│   │   └── scripts/
│   │       └── install-squirrelscan.sh
│   │
│   ├── org-jira/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── skills/
│   │   │   └── org-jira/
│   │   │       └── SKILL.md        # Org Jira conventions
│   │   └── .mcp.json               # Jira MCP config (if needed)
│   │
│   ├── org-confluence/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── skills/
│   │       └── org-confluence/
│   │           └── SKILL.md        # Confluence integration skill
│   │
│   ├── org-ticket-writing/
│   │   └── skills/
│   │       └── org-ticket-writing/
│   │           └── SKILL.md        # Mirrors existing local skill
│   │
│   └── org-writing-style/
│       └── skills/
│           └── org-writing-style/
│               └── SKILL.md        # Mirrors existing local skill
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── skill-request.yml       # Template for requesting new skills
│   ├── PULL_REQUEST_TEMPLATE/
│   │   └── new-skill.md            # PR template for new skill submissions
│   └── workflows/
│       ├── validate-skill.yml      # CI: validates SKILL.md format
│       └── notify-on-merge.yml     # Notify MCP server to refresh catalog
│
├── CONTRIBUTING.md                  # How to request/add skills
├── CATALOG.md                       # Human-readable skill catalog
└── README.md                        # Overview and quick start
```

---

## Skill Request → Approval Workflow (GitHub PR)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         SKILL REQUEST WORKFLOW                              │
│                                                                             │
│  1. PM REQUESTS                                                             │
│     ├─ Option A: Opens GitHub Issue using "Skill Request" template          │
│     ├─ Option B: Says "I want to request a skill" in Claude Desktop         │
│     │            → Claude calls org_skills(action: "request")           │
│     │            → Creates GitHub Issue automatically                       │
│     └─ Option C: Opens a PR directly (for devs adding their own skill)      │
│                                                                             │
│  2. TRIAGE                                                                  │
│     ├─ Issue reviewed by dev lead                                           │
│     ├─ Evaluated for: security, usefulness, maintenance burden              │
│     └─ Assigned to a dev if approved for development                        │
│                                                                             │
│  3. DEVELOPMENT                                                             │
│     ├─ Dev creates branch: skill/<skill-name>                               │
│     ├─ Writes SKILL.md + plugin structure                                   │
│     ├─ Tests locally with Claude Code                                       │
│     ├─ Tests remotely if it includes server-side tools                      │
│     └─ Opens PR using "New Skill" template                                  │
│                                                                             │
│  4. REVIEW                                                                  │
│     ├─ CI validates: SKILL.md format, marketplace.json syntax               │
│     ├─ Reviewer checks: instructions quality, security, no secrets          │
│     └─ If tool skill: reviewer verifies server-side CLI is installed        │
│                                                                             │
│  5. DEPLOYMENT                                                              │
│     ├─ PR merged → marketplace.json updated                                 │
│     ├─ GitHub Action notifies MCP server to refresh skill catalog           │
│     ├─ Mac devs: /plugin marketplace update org-skills                  │
│     └─ Windows users: skills appear automatically on next session           │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### GitHub Issue Template: Skill Request

```yaml
name: Skill Request
description: Request a new skill for the Joyus AI platform
labels: ["skill-request"]
body:
  - type: input
    attributes:
      label: Skill Name
      description: Short name for the skill (e.g., "audit-website")
      placeholder: my-new-skill
    validations:
      required: true
  - type: textarea
    attributes:
      label: What should this skill do?
      description: Describe what you want the AI to be able to do
      placeholder: "I want the AI to be able to..."
    validations:
      required: true
  - type: dropdown
    attributes:
      label: Skill Type
      options:
        - Knowledge only (instructions/conventions)
        - Tool (requires CLI or external software)
        - Integration (connects to an API)
        - Not sure
    validations:
      required: true
  - type: textarea
    attributes:
      label: Example prompts
      description: How would you ask the AI to use this skill?
      placeholder: "Audit our client's website for SEO issues"
  - type: textarea
    attributes:
      label: Additional context
      description: Links to tools, docs, or examples
```

### PR Template: New Skill

```markdown
## New Skill: [skill-name]

### Checklist
- [ ] SKILL.md follows the standard format
- [ ] Description is clear and helps Claude know when to use it
- [ ] Tested locally with Claude Code
- [ ] If tool skill: CLI/binary is installable on the server
- [ ] If tool skill: server-side execution tested
- [ ] marketplace.json updated with new entry
- [ ] No secrets or credentials in any files
- [ ] CATALOG.md updated

### Skill Type
- [ ] Knowledge (prompt-only)
- [ ] Tool (CLI required)
- [ ] Integration (API-based)
- [ ] Hybrid

### Security Review
- [ ] No filesystem access beyond temp directories
- [ ] No network access to internal services
- [ ] No credential exposure
- [ ] Rate limiting considered

### Testing
Describe how you tested this skill:
```

---

## Server-Side Skill Execution (for SquirrelScan and similar)

When a Windows user asks to audit a website, here's the flow:

```
Windows User (Claude Desktop)
      │
      │ "Audit staging.client-site.com for SEO issues"
      │
      ▼
Claude Desktop
      │
      │ MCP tools/call: squirrelscan_audit
      │ { url: "staging.client-site.com", categories: ["seo", "performance"] }
      │
      ▼
Joyus AI MCP Server
      │
      │ 1. Verify user has audit-website skill enabled
      │ 2. Validate URL (not internal, not blocked)
      │ 3. Run: squirrel audit staging.client-site.com --format llm --categories seo,performance
      │ 4. Capture output
      │ 5. Return results to Claude
      │
      ▼
Claude Desktop
      │
      │ Claude reads the LLM-formatted audit results
      │ Presents findings organized by severity
      │ Offers to create Jira tickets for issues found
      │
      ▼
User sees actionable audit report
```

### Server Requirements for Tool Skills

Each tool skill that requires CLI execution needs:

| Skill | CLI Tool | Install Command | Server Requirement |
|-------|----------|-----------------|-------------------|
| `audit-website` | `squirrel` | `npm install -g squirrelscan` | Node.js |
| (future) `lighthouse` | `lighthouse` | `npm install -g lighthouse` | Node.js + Chrome |
| (future) `pa11y` | `pa11y` | `npm install -g pa11y` | Node.js + Chrome |

The MCP server Dockerfile should pre-install these tools:

```dockerfile
# In Dockerfile
RUN npm install -g squirrelscan
# Future tool skills would be added here
```

---

## Confluence Integration

The existing MCP server has Jira integration but not Confluence. Adding Confluence:

### OAuth Scope Additions

Confluence uses the same Atlassian OAuth app. Add scopes:

```
read:confluence-content.all
write:confluence-content
read:confluence-space.summary
read:confluence-content.summary
```

### New MCP Tools

| Tool | Description |
|------|-------------|
| `confluence_search` | Search Confluence spaces and pages |
| `confluence_get_page` | Get page content (rendered or storage format) |
| `confluence_create_page` | Create a new page in a space |
| `confluence_update_page` | Update existing page content |
| `confluence_get_space` | Get space info and recent pages |
| `confluence_list_spaces` | List available spaces |

### Confluence Skill (Knowledge Layer)

The `org-confluence` skill would tell Claude about the organization's Confluence conventions:

```markdown
---
name: org-confluence
description: Organization Confluence conventions and workflows.
  Use when creating, updating, or searching Confluence pages.
---

## Organization Confluence Conventions

When working with Confluence:

- Project documentation lives in spaces named after the project
- Use the standard page hierarchy: Overview > Architecture > Runbooks > ADRs
- Meeting notes go under the "Meetings" parent page
- Always include a "Last Updated" macro at the top of technical docs
- Use the "Info" macro for important callouts
- Link related Jira tickets using the Jira macro
...
```

---

## Marketplace.json (Initial Version)

```json
{
  "name": "org-skills",
  "owner": {
    "name": "Example Org",
    "email": "dev@example.com"
  },
  "metadata": {
    "description": "Curated AI skills for the platform team",
    "version": "0.1.0",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "audit-website",
      "source": "./plugins/audit-website",
      "description": "Run comprehensive website audits for SEO, performance, accessibility, and security using SquirrelScan",
      "version": "1.0.0",
      "category": "quality",
      "tags": ["seo", "performance", "accessibility", "security", "audit"],
      "keywords": ["audit", "seo", "website", "squirrelscan", "performance"]
    },
    {
      "name": "org-jira",
      "source": "./plugins/org-jira",
      "description": "Organization-specific Jira workflows, JQL patterns, and ticket conventions",
      "version": "1.0.0",
      "category": "project-management",
      "tags": ["jira", "tickets", "agile"]
    },
    {
      "name": "org-confluence",
      "source": "./plugins/org-confluence",
      "description": "Read, create, and update Confluence pages with organization conventions",
      "version": "1.0.0",
      "category": "documentation",
      "tags": ["confluence", "docs", "wiki"]
    },
    {
      "name": "org-ticket-writing",
      "source": "./plugins/org-ticket-writing",
      "description": "Write actionable Jira tickets following organization standards with proper acceptance criteria",
      "version": "1.0.0",
      "category": "project-management",
      "tags": ["jira", "tickets", "user-stories", "acceptance-criteria"]
    },
    {
      "name": "org-writing-style",
      "source": "./plugins/org-writing-style",
      "description": "Organization brand voice, tone, and writing style for all content",
      "version": "1.0.0",
      "category": "content",
      "tags": ["writing", "brand", "content", "marketing"]
    }
  ]
}
```

---

## Implementation Order

### Step 1: Create the GitHub repo (this session)

Set up `<org>/skills` with marketplace.json, the audit-website skill, and the PR workflow templates.

### Step 2: Add Confluence tools to MCP server

Extend the existing Atlassian OAuth integration with Confluence API endpoints.

### Step 3: Add `org_skills` tool to MCP server

Build the catalog browsing tool that Windows users interact with through Claude Desktop.

### Step 4: Add server-side skill execution

Install SquirrelScan on the server, expose `squirrelscan_audit` as an MCP tool when the skill is enabled.

### Step 5: Port existing local skills to the marketplace

Move `org-ticket-writing`, `org-writing-style`, `drupal-coding-standards` etc. into the marketplace repo so they're available to all team members.

---

## Open Questions

| Question | Notes |
|----------|-------|
| GitHub repo visibility | Public or private? Private means devs need GitHub access. |
| Skill auto-update for MCP server | Webhook on merge, or periodic polling? |
| Per-user skill enablement | Do all users get all skills, or should there be user-level toggles? |
| Cost implications | Tool skills (SquirrelScan) add server CPU usage. Rate limiting? |
| Skill versioning | When a skill is updated in the repo, how do in-progress sessions handle it? |

---

*This document extends the [Platform Architecture](./PLATFORM_ARCHITECTURE.md). The MCP server codebase is in `/joyus-ai-mcp-server/`.*
