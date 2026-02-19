---
work_package_id: WP06
title: MCP Server (Profile + Verify Tools)
lane: planned
dependencies: [WP05]
subtasks: [T032, T033, T034, T035]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP06: MCP Server (Profile + Verify Tools)

## Objective

Expose the profile engine as MCP tools using the official Python `mcp` SDK (v1.26+). Implements 5 tools: build_profile, get_profile, compare_profiles, verify_content, check_fidelity.

## Implementation Command

```bash
spec-kitty implement WP06 --base WP05
```

## Context

- **Plan**: plan.md §A.7
- **Research**: research.md §R3 (official `mcp` SDK recommended over FastMCP 3.0)
- **API Contract**: contracts/mcp-tools-api.md §Profile Tools, §Verification Tools

---

## Subtask T032: MCP Server Entry Point

**Purpose**: Set up the MCP server skeleton using the official `mcp` Python SDK with stdio transport.

**Steps**:
1. Create `joyus_profile/mcp_server/server.py`
2. Implement server using the pattern from research.md:
   ```python
   from mcp.server import Server
   from mcp.server.stdio import stdio_server
   import asyncio

   server = Server("joyus-profile-engine")

   async def main():
       async with stdio_server() as (read_stream, write_stream):
           await server.run(read_stream, write_stream,
                            server.create_initialization_options())

   def run_server():
       asyncio.run(main())
   ```
3. Register CLI entry point: `joyus-profile serve --stdio` and `joyus-profile serve --port PORT`
4. **Critical**: Never write to stdout — use stderr for all logging
5. Add `cli/serve.py` with click command

**Files**:
- `joyus_profile/mcp_server/__init__.py` (updated)
- `joyus_profile/mcp_server/server.py` (new, ~40 lines)
- `joyus_profile/cli/serve.py` (new, ~30 lines)

**Validation**:
- [ ] `joyus-profile serve --stdio` starts without errors (Ready message on stderr)
- [ ] Server responds to MCP initialization handshake

---

## Subtask T033: Profile MCP Tools

**Purpose**: Implement build_profile, get_profile, compare_profiles as MCP tools.

**Steps**:
1. Create `joyus_profile/mcp_server/tools/profile_tools.py`
2. Register tools on the server (reference: contracts/mcp-tools-api.md for exact schemas):

   **build_profile**: corpus_path, author_name, domain, output_dir, formats → status, profile_id, fidelity_tier, corpus_stats, confidence, skill_files, duration

   **get_profile**: profile_dir → profile_id, author_name, domain, fidelity_tier, corpus_size, confidence, voice_contexts, sections_summary

   **compare_profiles**: profile_a_dir, profile_b_dir → overall_similarity, section_similarity, distinguishing_features

3. Wrap all sync engine calls in `asyncio.to_thread()`:
   ```python
   @server.call_tool()
   async def call_tool(name: str, arguments: dict):
       if name == "build_profile":
           result = await asyncio.to_thread(_build_profile, **arguments)
           return [TextContent(type="text", text=json.dumps(result))]
   ```
4. Return errors in the standard format from mcp-tools-api.md §Error Responses

**Files**:
- `joyus_profile/mcp_server/tools/profile_tools.py` (new, ~120 lines)

**Validation**:
- [ ] `build_profile` tool creates skill files and returns success
- [ ] `get_profile` loads and summarizes an existing profile
- [ ] `compare_profiles` returns similarity metrics
- [ ] Errors return structured JSON with error type and details

---

## Subtask T034: Verify MCP Tools

**Purpose**: Implement verify_content and check_fidelity as MCP tools.

**Steps**:
1. Create `joyus_profile/mcp_server/tools/verify_tools.py`
2. Register tools:

   **verify_content**: text, profile_dir, tier, voice_key → tier1 result, tier2 result, overall_passed, access_level

   **check_fidelity**: text, profile_dir, voice_key → score, passed, feedback, latency_ms (Tier 1 only, <500ms)

3. Wrap in `asyncio.to_thread()` for sync faststylometry calls
4. Return latency_ms for check_fidelity to verify performance

**Files**:
- `joyus_profile/mcp_server/tools/verify_tools.py` (new, ~80 lines)

**Validation**:
- [ ] `verify_content` returns both tier results
- [ ] `check_fidelity` returns in <500ms with score and feedback
- [ ] Invalid profile_dir returns clear error

---

## Subtask T035: MCP Integration Tests

**Purpose**: Verify MCP tools work end-to-end via the protocol.

**Steps**:
1. Create `tests/integration/test_mcp_server.py`
2. Test tools using the `mcp` client library:
   ```python
   from mcp.client import ClientSession
   from mcp.client.stdio import stdio_client

   async def test_build_profile_tool():
       async with stdio_client("joyus-profile", ["serve", "--stdio"]) as (read, write):
           async with ClientSession(read, write) as session:
               await session.initialize()
               result = await session.call_tool("build_profile", {
                   "corpus_path": "fixtures/example/",
                   "author_name": "Test Author",
                   "domain": "general",
                   "output_dir": "/tmp/test-mcp/",
               })
               assert result.content[0].text contains "success"
   ```
3. Test error cases: missing corpus, invalid profile path
4. Test tool listing: ensure all 5 tools appear in `list_tools()`

**Files**:
- `tests/integration/test_mcp_server.py` (new, ~100 lines)

**Validation**:
- [ ] All 5 tools callable via MCP protocol
- [ ] Error responses follow the standard format
- [ ] Server handles concurrent tool calls (separate test)

---

## Definition of Done

- [ ] `joyus-profile serve --stdio` starts and responds to MCP handshake
- [ ] All 5 MCP tools functional (build_profile, get_profile, compare_profiles, verify_content, check_fidelity)
- [ ] Integration tests pass via MCP protocol
- [ ] No stdout pollution (all logs to stderr)
- [ ] Claude Desktop config snippet works (as shown in quickstart.md §4)

## Risks

- **mcp SDK version**: Pin to `mcp>=1.20,<2.0` to avoid breaking changes
- **asyncio.to_thread() overhead**: Each tool call spawns a thread — acceptable for single-user MCP server, may need pooling for multi-user
- **stdio buffering**: Ensure all JSON responses are flushed immediately (no buffered stdout)
