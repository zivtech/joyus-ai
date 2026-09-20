# WP0 / §6.3 readiness-gate disposition — enabled-skill cross-turn persistence

**Date:** 2026-09-19 · **Status: RESOLVED (readiness gate).** This records the outcome
of the WP0 persistence question so the future `enable`/`disable` work (WP3) starts from
evidence, not assumption. It does **not** change WP01/WP02 scope; WP0/WP3 implementation
remain out of this mission's build scope.

## Question

Does a tool-returned `SKILL.md` body (delivered as a `tools/call` text result and
"enabled") persist as active guidance across turns — like a natively-loaded skill — or
fade like an ordinary tool result?

## Finding

- **In-window: persists on every model.** A declarative body delivered once (server then
  detached) was spontaneously re-applied across ≥10 turns / 5 distractors — haiku, sonnet,
  opus all 3/3 on probe turns; 0/2 on a no-enable control.
- **Across a compaction event: model-dependent.** Forced `/compact`, then probed
  (org_skills called only pre-compaction — verified zero post-compaction re-calls, so
  results are persistence, not re-fetch):

  | model | server detached (removed) | server attached (real deployment) |
  |---|---|---|
  | haiku  | 0/3 | 0/3 |
  | sonnet | (not run) | 3/3 |
  | opus   | 1/3 | 3/3 |

  Deployment column = **haiku 0/3, sonnet 3/3, opus 3/3**; the failure boundary is
  between haiku and sonnet. Mechanisms: haiku's compaction summary demotes the rule to a
  passing mention it doesn't re-activate; sonnet/opus re-encode it as an active directive
  (opus/sonnet even apply the convention to their own compaction summary, re-seeding it).
  Opus's detached 1/3 was caused by a "the originating MCP server has been removed …
  standing not confirmed" de-authorization — an artifact of the detached test, absent in
  real deployment where the server stays connected.

## Implications for WP3 (`enable`/`disable`)

1. **Implement re-inject-on-compaction as the default**, not an optimization: on a
   relevant turn, if session state says a skill is enabled, re-serve its body rather than
   trusting the original `enable` result to have survived compaction. Required because a
   session may run on a weaker/uncertain summarizer (haiku-class drops it). The
   session-scoped enablement store (D1 work, branch `claude/d1-skill-enablement-session-store`)
   is the correct substrate.
2. **Keep the org_skills server connected for the whole session** — a disconnected/"removed"
   server de-authorizes an enabled skill after compaction.
3. **Declarative bodies only.** Imperative "always do X / don't mention this" bodies are
   rejected by the prompt-injection classifier (separate 2026-09-12 finding). Warrants a
   lint rule on the `<org>/skills` repo.
4. **Do not assume native-skill "stickiness."** A tool-returned body is ordinary context
   text; its cross-turn durability is a property of the summarizer + re-injection, not
   special weight. This is distinct from Claude Code's native/deferred skill loading.

## Method, limits, provenance

Headless `claude -p` on CLI ≥ 2.1.278 (headless `--resume` retains prior-turn context —
the blocker that stopped the 2026-09-12 attempt is gone), driving a stdlib stub MCP
server that returns a declarative body; ground truth taken from on-disk session
transcripts. **Limits:** n=1 per cell (consistent, not a stability distribution);
headless is a proxy for the real Desktop/interactive client (one manual Desktop
confirmation still owed); window-overflow *eviction* (vs `/compact`) untested; single
skill / single trigger type. Full write-up, harness, and raw transcripts live outside
this repo in the investigation workspace (`context-audit/16-org-skills-63-persistence-results.md`,
`…/17-org-skills-63-handoff.md`, `…/sec63-persistence-spike/`).
