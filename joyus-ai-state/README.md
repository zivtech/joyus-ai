# joyus-ai-state

Local MCP server for session/context state and workflow enforcement — the
public foundation shipped by features `002 Session & Context Management` and
`004 Workflow Enforcement`.

It runs on the developer's machine (state lives in local SQLite), gives Claude
sessions durable context across restarts, and enforces workflow guardrails
(quality gates, skill checks, git guardrails, audit trail) before actions
execute.

## Quickstart

```bash
cd joyus-ai-state
npm install
npm run build
```

Two executables ship with the package:

| Bin | Purpose |
| --- | --- |
| `joyus-ai-mcp` | stdio MCP server — wire this into your MCP client |
| `joyus-ai-service` | companion service mode |

### Wiring into Claude Code / Claude Desktop

Add to your MCP configuration (`.mcp.json` in a project, or the Claude Desktop
config):

```json
{
  "mcpServers": {
    "joyus-ai-state": {
      "command": "node",
      "args": ["/absolute/path/to/joyus-ai-state/bin/joyus-ai-mcp"]
    }
  }
}
```

## MCP tools

Session & context tools (feature `002`):

| Tool | What it does |
| --- | --- |
| `get_context` | Load canonical context for the current session |
| `save_state` | Persist session state to the local store |
| `verify_action` | Check an intended action against canonical state before executing |
| `check_canonical` | Inspect canonical-document state and divergence |
| `share_state` | Share state across sessions |
| `query_snapshots` | Query historical state snapshots |

Workflow-enforcement tools (feature `004`) cover quality gates, branch and
skill verification, upstream checks, corrections, audit queries, enforcement
status, hygiene checks, and the kill switch. See `src/mcp/tools/` for the
complete set — each tool is one file.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run validate    # typecheck + test
```

Both checks also run in CI (`.github/workflows/validate.yml`, `validate-state`
job).

## Layout

```
src/
├── collectors/    # state collectors
├── core/          # core types and config
├── enforcement/   # gates, skills, git guardrails, audit
├── mcp/           # MCP server + tools (one file per tool)
├── service/       # companion service mode
├── state/         # canonical store, divergence, lock, share, store
└── utils/
```

## License

Apache-2.0, same as the repository root.
