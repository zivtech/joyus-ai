---
name: discovery-investigation
description: "Audit Drupal sites for editorial UX issues, config gaps, and content type problems. Produces scored evidence for proposals."
version: 0.1.0
---

## JTBD (Jobs To Be Done)

### Primary Job
When I need to audit a Drupal site before writing a proposal or scoping remediation work,
I want a structured investigation that runs config analysis and browser tests in parallel and compiles findings by severity,
so I have evidence-backed findings to quote in a proposal rather than impressions from a single walkthrough.

### Secondary Jobs
- When I've already started a discovery session and need to resume, I want the state file to tell me exactly which phases completed, so I don't re-run expensive browser tests or agent waves.
- When I need a quick visual summary of findings to share with the agency team before the proposal is written, I want a password-protected HTML report deployed to GitHub Pages, so team members can review findings asynchronously.

### Job Layers
- Functional: Produce `docs/discovery/findings.md` with critical/major/minor findings, root causes, and evidence. Also produce a deployed visual HTML report.
- Emotional: Replace the anxiety of "did we miss something important?" with systematic coverage — config YAML analysis + browser tests + UX analysis leave fewer gaps than ad-hoc walkthroughs.
- Social: Give the team a shareable, password-protected report that demonstrates due diligence to stakeholders or the client.

### This Skill Is For
- An agency practitioner auditing a Drupal site before writing a proposal.
- A developer investigating editorial UX problems before scoping remediation work.
- A user picking up an interrupted discovery session (reads state file to resume).

### This Skill Is NOT For
- Non-Drupal sites — the config analysis reads Drupal config YAML files and admin paths.
- Sites where local environment is not running — Playwright MCP requires a reachable URL.
- Generating a proposal — use `proposal-draft` after this skill produces findings.

### Paired With
- `discovery-proposal`: The orchestrator that invokes this skill and passes the state file forward.
- `proposal-draft`: The next phase — takes findings.md as input.
- `drupal-critic`: Used as an adversarial reviewer of the investigation plan before execution.

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|-----------------|-------------|----------------------|
| Running fresh investigation | Plan → critic review → Wave 1 config analysis → browser tests → Wave 2 UX analysis → findings → HTML report | findings.md, visual report URL, updated state file |
| Resuming interrupted session | Read state file → skip completed waves → resume from current step | Remaining findings + report |
| Already has config findings, needs UX analysis | Skip Wave 1, run Wave 2 directly | Wave 2 findings appended to findings.md |

### When to Escalate
- If Playwright MCP is not available: skip browser testing, note the gap in findings, and proceed with config-only analysis.
- If Lando MCP is not available: skip config YAML analysis, note the gap, and proceed with browser-testing-only.
- If `gh` is not authenticated: produce findings.md but skip HTML report deploy; save report locally.

<Purpose>
discovery-investigation runs the evidence-gathering phase of an agency engagement. It is designed to be thorough, parallel, and reproducible.

Investigation structure:
- **Wave 1** (config analysis): 4 parallel haiku agents read Drupal config YAML files — content type configs, field weights, widget types, display modes. Fast, read-only, no site access required.
- **Browser testing**: Playwright MCP navigates to each content type's create/edit form, takes screenshots, logs JavaScript console errors, notes field ordering and widget problems.
- **Wave 2** (UX analysis): 3 parallel agents synthesize Wave 1 + browser findings — root cause mapping, business impact prioritization, quick wins identification.
- **Findings compilation**: All findings compiled into structured `findings.md` with severity ratings and evidence.
- **HTML report**: Visual report built and deployed to GitHub Pages with password protection.

Requires: Lando MCP (for config file access, available on joyus-ai platform), Playwright MCP (for browser testing, available on joyus-ai platform), gh CLI (for GitHub Pages deploy).
</Purpose>

<Use_When>
- User says "run discovery", "audit the site", "investigate the Drupal site", "start investigation"
- User has a local Drupal site running and wants findings before writing a proposal
- discovery-proposal has invoked this skill as Phase 2
- User needs to resume an interrupted investigation (state file exists with current_phase: "investigation-executing")
</Use_When>

<Do_Not_Use_When>
- User wants a proposal, not just findings — use discovery-proposal to get both
- The site is not Drupal
- The local environment is not running and cannot be started
- User wants a quick single-page audit summary — just browse the site manually; this skill is for systematic multi-wave analysis
</Do_Not_Use_When>

<Why_This_Exists>
Ad-hoc site walkthroughs miss:
- Config issues that aren't visible in the browser (field weights, widget types in YAML)
- JavaScript console errors that only appear in certain browsers or with certain data
- Patterns that only emerge when you analyze multiple content types together

This skill makes investigation systematic: every content type gets the same test, every config file gets the same analysis, findings are rated by severity with evidence, and the output is structured enough to feed directly into proposal-draft.
</Why_This_Exists>

<Steps>
## STEP 0 — Context check

Check for `.omc/state/discovery-proposal-state.json`. If it exists, read it:
- `environment.local_url` — the local site URL
- `client_name`, `client_slug`
- `paths.findings_md`

If state file does not exist, ask:
1. "What is the client name and project?" (one sentence)
2. "What is the local site URL and admin path?"
3. "Is `gh` CLI authenticated? (`gh auth status`)"

Create a minimal state file. Set `current_phase: "investigation"`.

---

## STEP 1 — Investigation plan

Draft an investigation plan covering:

**Config analysis targets (via Lando MCP):**
- All content types (from `config/sync/core.entity_form_display.node.*.yml`)
- Form display configs, field weights, widget types, display modes

**Browser test targets (via Playwright MCP):**
- The 5 most-used content types by editorial importance
- Create form + edit form for each
- Any content type flagged in existing handoff notes

**Analysis questions:**
- Are revisions enabled on all content types?
- Are there field widgets creating poor editorial UX (large multiselect, unconfigured entity reference)?
- Are there missing or misconfigured display modes?
- Are there deprecated or redundant fields?

Write plan to `docs/discovery/investigation-plan.md`.

---

## STEP 2 — Plan review (adversarial)

Dispatch a `drupal-critic` agent through the local catalog/meta-router to review the investigation plan. The wrapper does not override its model policy.

Prompt: "Review this investigation plan for a Drupal site editorial UX audit. Find: missing test coverage, invalid assumptions about the site, phases in the wrong order, and anything that would cause us to miss a high-severity finding. Be specific."

**Gate:** Announce issue count. Ask: "Should I revise the plan before executing? (yes / execute as-is / review first)"

On "yes": revise plan, write `docs/discovery/investigation-plan-v2.md`.

Update state: `current_phase: "investigation-executing"`.

---

## STEP 3 — Config analysis (Wave 1)

Dispatch 4 agents in parallel through the local router for fast, read-only config scans via Lando MCP. Model selection follows catalog/meta-router policy:

- **content_type_config_analyst** — Read all form display configs from `config/sync/core.entity_form_display.node.*.yml`. List: field count, field order, any missing required fields, fields with default/unconfigured widgets.
- **field_weight_analyst** — Analyze field weight assignments across all form displays. Flag: inconsistent ordering between types, fields buried below weight 50 with no apparent reason.
- **widget_type_analyst** — Catalog all widget types. Flag: `options_select` with more than 20 options (should be autocomplete), `entity_reference_autocomplete` vs `inline_entity_form` mismatches, deprecated widgets.
- **display_mode_analyst** — List all view modes defined vs actually configured. Flag: content types using default display mode only, missing `teaser` or `search_index` configurations.

Compile into `docs/discovery/wave1-config-findings.md`.

---

## STEP 4 — Browser testing (via Playwright MCP)

For each content type in the investigation plan:

1. Navigate to `/node/add/[type]`
2. Take a screenshot
3. Check browser console for JavaScript errors
4. Note: number of fields visible, widget issues, field ordering problems, missing required field indicators, form length (scroll depth)
5. If an edit URL exists for existing content, navigate to it and note differences

**Red flags to flag immediately:**
- Publication status as a listbox with 100+ items
- Any `$.isArray` JavaScript errors in console (Select2 compatibility issue)
- Forms with no visible Save button above the fold
- Reference fields with no search/autocomplete

Write findings to `docs/discovery/browser-test-findings.md`.

---

## STEP 5 — UX analysis (Wave 2)

Dispatch 3 agents in parallel after Wave 1 and browser testing complete:

- **ux-analyst** — Read `wave1-config-findings.md` and `browser-test-findings.md`. Identify root causes linking multiple surface symptoms. Produce: prioritized findings with severity (critical/major/minor) and root cause.
- **priority-mapper** — Read all findings. Rank by business impact: editorial time cost, content loss/error risk, blockers to new content creation.
- **quick-wins** — Identify findings fixable with zero migration risk (config changes, module enables, widget swaps). List top 7.

---

## STEP 6 — Compile findings

Write `docs/discovery/findings.md`:

```markdown
# Discovery Findings — [Client Name]
Generated: [date]

## Summary
- Critical: N | Major: N | Minor: N | Quick wins: N

## Critical Findings
### C1 — [Title]
**Root cause:** ...
**Impact:** ...
**Evidence:** [screenshot ref or config file]
**Fix:** ...

## Major Findings
...

## Minor Findings
...

## Quick Wins (zero migration risk)
...
```

Update state file:
- `paths.findings_md: "docs/discovery/findings.md"`
- `investigation.critical_findings: N`
- `investigation.major_findings: N`
- `investigation.minor_findings: N`
- `investigation.content_types_tested: N`
- `completed_phases` adds `"wave1"`, `"browser-testing"`, `"wave2"`, `"findings"`

---

## STEP 7 — Visual HTML report

Invoke `/frontend-design` with prompt:

"Build a password-protected visual report page at `~/claude/zivtech-demos/projects/[client-slug]/report.html`. Audience: agency preparing a proposal. Show: critical/major/minor finding counts, a card per finding (title, severity badge, root cause, fix), quick wins section. Use navy/gold palette (navy: #1e3a5f, gold: #d4a73a). Self-contained HTML, no external libraries. Data: [paste findings.md content]"

After HTML is written:
1. Update `~/claude/zivtech-demos/.github/workflows/deploy.yml` to add the new project.
2. Commit: `feat: add [client-slug] discovery report`
3. Push and wait for GitHub Actions success.
4. Update state: `paths.visual_report_url: "https://zivtech.github.io/zivtech-demos/[client-slug]/"`

---

## STEP 8 — Completion

Update state:
- `current_phase: "proposal"` (next phase)
- `completed_phases` adds `"investigation"`
- `updated_at: [timestamp]`

Announce:
```
✓ Investigation complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Critical findings:    N
Major findings:       N
Minor findings:       N
Quick wins:           N
Content types tested: N
Findings file:        docs/discovery/findings.md
Visual report:        [url]  pw: [client-slug]2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If running standalone: suggest "Run `/proposal-draft` to convert these findings into a scoped proposal."
</Steps>

<Tool_Usage>
- Use Lando MCP tools to read config YAML files from `config/sync/` — requires Lando MCP (joyus-ai platform)
- Use Playwright MCP tools (`browser_navigate`, `browser_take_screenshot`, `browser_console_messages`, `browser_snapshot`) for browser testing — requires Playwright MCP (joyus-ai platform)
- Use Agent tool to dispatch Wave 1 and Wave 2 parallel agents
- Use Skill tool to invoke `/frontend-design` for the visual report
- Use Bash to commit and push the report to zivtech-demos
- Agents in Wave 1 and Wave 2 must use native Read/Glob/Grep tools only — NOT mcp__filesystem__ (fails in subagent context)
- Do NOT nest agent delegation: Wave 1/Wave 2 agents should not spawn their own agents
</Tool_Usage>

<Escalation_And_Stop_Conditions>
- If Playwright MCP is unavailable: skip browser testing, annotate findings.md with "Browser testing skipped — Playwright MCP not available", proceed with config-only analysis.
- If Lando MCP is unavailable: skip config YAML analysis, annotate findings.md with "Config analysis skipped — Lando MCP not available", proceed with browser-testing-only.
- If config YAML files are not in `config/sync/`: ask for the correct config directory before dispatching Wave 1 agents.
- If gh CLI is not authenticated: skip GitHub Pages deploy, save report to `docs/discovery/report.html`, skip state URL update.
</Escalation_And_Stop_Conditions>

Task: {{ARGUMENTS}}
