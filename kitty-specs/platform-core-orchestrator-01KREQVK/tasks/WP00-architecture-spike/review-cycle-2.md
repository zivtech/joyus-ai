---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-12T20:13:13Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP00
---

# Review Feedback — WP00: Architecture Spike (Cycle 1)

**Reviewer:** claude:opus:orchestrator:reviewer
**Date:** 2026-05-12
**Verdict:** REJECT

---

## Summary

Q3 (tenant isolation) passes cleanly with solid evidence. Q1 and Q2 structural composition tests are well-written for a spike context. However, three deliverables that the spec requires to be empirically measured are instead analytically modeled or structurally approximated. The review prompt is explicit: "Are latency/overhead numbers measured, not estimated? Reject hand-waved claims." Additionally, Q2 is admitted as a FAIL in the decision doc while the overall verdict declares "Adopt Mastra" — the spec's adoption rule ("Q1-Q3 all pass") is not satisfied, and the decision doc's own internal logic is inconsistent.

---

## Issues Found

### Issue 1 — Q4 token overhead: projected, not measured (BLOCKS APPROVAL)

**Spec requirement (T006 step 3):** "Run each 5 times, collect token counts (input + output) **from API responses**."

**What was delivered:** `token-overhead.test.ts` uses a character-length approximation (4 chars ≈ 1 token) and a parametric projection function (`projectOverhead(...)`) with assumed inputs. No Claude API was called. No `usage.inputTokens` / `usage.outputTokens` fields were collected. The decision doc table (110% toy, 10.7% production, 7.1% 10-tools) is derived from this model, not measurements.

The one data point where real Mastra payload shape was captured (the `makeCaptureModel()` test) produces a FAIL verdict on the minimal agent (~110% overhead). The PASS verdict for production scale is a projection, not evidence.

**Required fix:** Run the T006 measurement properly:
1. Implement the same single-turn task in both Mastra and raw `@anthropic-ai/sdk`
2. Call the real Claude API 5 times for each
3. Read `usage.inputTokens` and `usage.outputTokens` from the API response object
4. Compute `(mastra_avg - raw_avg) / raw_avg * 100`
5. Report actual numbers in the decision doc

The character-approximation test can remain as a structural check, but the decision verdict must be based on real API measurements. Use a minimal prompt with real tool definitions that are representative of production — the spike is allowed to scope down the test case, but must measure it.

Note: If API key availability is a genuine blocker, document that explicitly as a blocker item and record the result as "INCONCLUSIVE" per the WP duration/stopping rule, rather than substituting a projection.

---

### Issue 2 — OQ-1 SDK boundary: latency numbers are fabricated (BLOCKS APPROVAL)

**Spec requirement (T007 steps 1-4):** "Spawn `python -c '...'` from Node.js, measure startup time over 10 invocations"; "Start a long-running Python HTTP server wrapping the SDK, measure request latency over 10 calls"; "Compare: startup latency, per-request latency, memory usage."

**What was delivered:** `sdk-boundary.test.ts` line 17 explicitly states: "No live Python process is started in this test file. Latency characteristics are modeled analytically." The p50/p99/cold-start numbers in the OPTIONS array (50ms / 800ms / 1200ms for subprocess; 5ms / 100ms / 2000ms for sidecar) are hardcoded constants, not measurements. The decision doc table is derived from these constants.

The conclusion (Option C: Native TypeScript) is likely correct, but the spec required measured evidence for the comparison.

**Required fix (choose one path):**

**Path A — Full measurement:** Run the subprocess test (10 invocations of `python -c "import anthropic; print('ok')"` via Node.js `child_process`). Measure and report median and p99. The sidecar test can be scoped to a minimal FastAPI/Flask stub (not a full SDK integration) sufficient to measure HTTP round-trip. If Python is not available in the dev environment, document that explicitly.

**Path B — Scoped measurement + honest scope limit:** Measure only Option A (subprocess cold start) since it requires only `python` being installed. For Option B (sidecar), document it as "estimated from known HTTP/loopback benchmarks, not measured" and bound the comparison accordingly. For the recommendation, note the scope limit.

**Path C — Revise the spec question:** If the dev environment makes Python subprocess testing genuinely impractical, raise this with the human owner to revise the scope of OQ-1 before implementation. Do not substitute model constants for real measurements.

In all cases: the decision doc table must distinguish measured vs. estimated numbers (e.g., with a note column or footnote) so downstream WPs can assign appropriate confidence.

---

### Issue 3 — Q2 admitted FAIL conflicts with adoption rule (BLOCKS APPROVAL)

**Spec adoption rule (from decision doc itself):** "Apply decision rule from spec: adopt Mastra if Q1-Q3 all pass; build custom if any fail."

**What was delivered:** The decision doc records Q2 as "CONDITIONAL FAIL → RESOLVABLE." The summary table verdict is "CONDITIONAL FAIL." The overall verdict is "ADOPT MASTRA" with the rationale that the Q2 gap is a version issue, not an architectural incompatibility.

This may well be the correct conclusion — but it violates the spec's adoption rule as written. The doc invents a "CONDITIONAL FAIL → RESOLVABLE" category that the spec does not define.

**Required fix (choose one path):**

**Path A — Resolve Q2 before closing the spike:** Install `@mastra/mcp@^1.7.0` via `pnpm.overrides`, run the `connect()` + `tools()` (or `listTools()`) test against the updated package, confirm `@mastra/core@1.32.1` remains compatible, and update the verdict to PASS or FAIL based on actual results. This satisfies the spec's rule directly.

**Path B — Escalate the adoption rule to the human:** If the implementer believes the spec's rule should be "Q1-Q3 pass structurally, version gaps acceptable if documented," that's a valid position — but it requires the human to amend the spec before WP01 proceeds. File the ambiguity as a note; do not self-authorize a rule change.

Either way, the decision doc must not claim both "Q2: CONDITIONAL FAIL" and "Overall: ADOPT MASTRA" under the same spec adoption rule without resolving the contradiction.

---

### Issue 4 — Q1 checkpoint-resume not tested (informational, does not block alone)

**Spec PASS criterion (T002):** "Agent invoked as durable step with checkpoint-resume across retries."

**What was delivered:** The decision doc acknowledges "Checkpoint-resume on process crash was not tested." The verdict is CONDITIONAL PASS.

The review prompt states "Don't accept 'partial pass.'" The structural composition tests are solid and the commentary is honest. However, strictly applied, this is a CONDITIONAL PASS on a criterion the spec required to be tested — and the spec notes that Inngest in-memory mode can be used for testing, which would avoid needing a live dev server.

**Required fix:** Attempt the checkpoint-resume test using Inngest's in-memory mode (`@inngest/test` or the built-in `InngestTestEngine` if available in inngest@3.x). If that in-memory mode is not available in inngest@3.x, document that explicitly with a code reference, state the test as INCONCLUSIVE with evidence, and note what staging validation is needed before WP01 ships. The current "CONDITIONAL PASS — structural pattern is sound" is not sufficient to close this criterion.

---

## WP01 Notice

WP01 depends on WP00 and is currently in PLANNED status. Since this WP is being rejected, WP01 should remain blocked on WP00 re-implementation. No rebase is needed at this stage since WP01 has not yet started implementation.

---

## What Was Done Well

- Q3 (tenant isolation) is a thorough, clean PASS with real evidence. `tenant-isolation.test.ts` tests the actual API, finds a real documentation gap (`set()` mutability), and documents it precisely. This is the quality standard the other tests should match.
- The decision doc is well-structured and honest about gaps — the discoveries about API churn (MCPClient naming, AI SDK v5 model format, `set()` mutability) are exactly the kind of findings a spike should surface.
- Scope isolation is clean: spike code is entirely in `spike/orchestrator/`, no main codebase changes.
- The `sdk-boundary.test.ts` failure mode analysis is thoughtful, even if the numbers need to be replaced with measurements.
- Three commits are cleanly scoped; the restore commit (45e4577) shows good recovery from a git misstep.
