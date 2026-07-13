---
name: design-system-documenter
type: executor
description: "Document existing design tokens — CSS custom properties, Tailwind config, SCSS vars. Generates design system docs."
version: 1.0.0
---

# Design System Documenter

Extract and document an existing codebase's design system into a standardized DESIGN.md file. This is the primary producer of portable DESIGN.md artifacts in the ecosystem.

## JTBD (Jobs To Be Done)

### Primary Job
When I have an existing codebase with design tokens scattered across config files, CSS, and theme objects,
I want those tokens extracted, semantically named, and documented in a single DESIGN.md,
so that downstream design skills (planners, executors, critics) can consume a consistent design system without re-reading source files.

### Secondary Jobs
- When I'm onboarding to a new project and need to understand its visual language, I want a DESIGN.md that captures the design system in human-readable form, so I can make design-consistent decisions without archaeology.
- When I have a DESIGN.md that's gone stale, I want to refresh it from the current codebase, so downstream skills work with accurate token values.
- When design-partner has produced a direction but no tokens exist in code yet, I want to scaffold a DESIGN.md from the direction, so executors have a concrete token reference to implement against.

### This Skill Is For
- A developer or designer working with an existing codebase that has design tokens but no centralized documentation
- A team onboarding to a project that needs a design system inventory
- A team that wants downstream design skills to work with their existing tokens

### This Skill Is NOT For
- A team starting from scratch with no existing tokens — use `design-partner` first to establish direction
- A team using Google Stitch — use `stitch-planner` Phase 4 (design-md extraction via Stitch MCP)
- A team that needs a token quality review — run this first to produce DESIGN.md, then use `design-token-critic`

### Paired With
- `design-partner`: Upstream (optional) — provides aesthetic direction to enrich atmosphere descriptions
- `design-token-critic`: Downstream — reviews the produced DESIGN.md for token quality, naming, contrast, coverage
- `web-design-executor`: Downstream — consumes DESIGN.md to derive CSS custom properties
- `mobile-design-executor`: Downstream — consumes DESIGN.md to map tokens to React Native StyleSheet
- `web-design-planner`: Downstream — propagates DESIGN.md tokens into its Design Token Table
- `stitch-planner`: Parallel — for Stitch-based projects, stitch-planner produces DESIGN.md via MCP; this skill produces it from source code

## Use When
- Existing codebase with design tokens that need documentation
- Onboarding to a project — need to understand the visual system
- Refreshing a stale DESIGN.md from current code
- Scaffolding DESIGN.md from design-partner direction (no code tokens yet)

## Schema Reference
This skill produces DESIGN.md files conforming to the canonical schema at:
`design-skills/shared-design-core/.claude/skills/shared-design-core/references/design-md-schema.md`

Apply the shared research-backed workflow while documenting:
`design-skills/shared-design-core/.claude/skills/shared-design-core/references/research-backed-design-workflow.md`

## Research-Backed Documentation Preflight

Before extraction:
- Build a `Reference Inventory` from project-local token sources, component libraries, Figma/Pencil files, user references, public research-only references, and missing evidence.
- Read DESIGN_MEMORY.md when present. Reuse prior semantic token names, rationale, rejected directions, and source authority decisions unless the user requests a change.
- Treat public design examples and third-party DESIGN.md repositories as inspiration/provenance inputs only. Do not copy branded token systems, prompt bodies, screenshots, or proprietary examples into the generated DESIGN.md.
- Record source authority: which file, tool, or human-provided reference wins when sources conflict.
- Keep evaluation local-first: source scans, contrast calculations, token diffing, and no Anthropic API for benchmark execution unless explicitly overridden by the user.

## Extraction Reliability Tiers

Not all token sources are equally reliable for automated extraction. This skill uses a tiered approach:

### Tier 1: Auto-Extract (high confidence)
These sources can be reliably parsed with Read + Grep:
- **CSS custom properties** — grep for `--color-*`, `--spacing-*`, `--font-*`, `--radius-*`, `--shadow-*`
- **CSS variables in `:root`** or theme blocks — structured, predictable format
- **Drupal `*.libraries.yml`** — YAML, directly readable
- **Style Dictionary JSON** — structured token format, directly readable

### Tier 2: Assisted Extract (medium confidence)
These sources require reading + human verification:
- **Tailwind `tailwind.config.*`** — JS/TS objects; read the file, extract `theme.extend` values, present for confirmation
- **MUI `createTheme()` / Chakra `extendTheme()`** — JS objects; read, extract palette/typography/spacing, present for confirmation
- **SCSS/Less variables** — grep for `$var-name:` or `@var-name:`, present for confirmation

### Tier 3: Guided Documentation (low confidence, human-driven)
These sources require the user to provide or confirm values:
- **Figma tokens** (if Figma MCP unavailable) — ask user for exported token JSON or key values
- **Design partner direction** (no code yet) — translate direction prose into token scaffold
- **Ad-hoc inline styles** — cannot reliably extract; ask user to identify key patterns

## Protocol

### Phase 1: Preflight Detection

Detect the project's framework and styling system by scanning for config files:

**Framework detection** (check in order):
| File | Framework |
|------|-----------|
| `next.config.*` | Next.js |
| `vite.config.*` | Vite |
| `remix.config.*` | Remix |
| `astro.config.*` | Astro |
| `*.info.yml` (with `type: theme`) | Drupal |
| `composer.json` (with `drupal/core`) | Drupal |
| `angular.json` | Angular |
| None of above | Plain HTML/CSS |

**Styling system detection** (check in order):
| File/Pattern | Styling System |
|-------------|---------------|
| `tailwind.config.*` | Tailwind CSS |
| `theme.ts` or `theme.js` with `createTheme` | Material UI |
| `theme/` dir with `extendTheme` | Chakra UI |
| `config.json` with `source` + `platforms` | Style Dictionary |
| `*.libraries.yml` | Drupal asset library |
| `--*` in CSS files (`:root` block) | CSS custom properties |
| `$` variables in `.scss` files | SCSS |

**Existing DESIGN.md detection:**
- Check discovery paths: `./DESIGN.md`, `./docs/DESIGN.md`, `./.design/DESIGN.md`
- If found: this is an UPDATE operation — read existing, note what will change
- If not found: this is a CREATE operation
- Check for DESIGN_MEMORY.md and record prior decisions that affect semantic names, token roles, rejected directions, or source authority.

Report findings and wait for user confirmation before proceeding.

### Phase 2: Token Extraction

Execute extraction per the detected styling system's reliability tier.

**Tier 1 (auto):** Extract values directly, organize by category (color, typography, spacing, radius, shadow, motion).

**Tier 2 (assisted):** Read the config file, extract recognizable token patterns, present a summary to the user:
```
I found these tokens in tailwind.config.ts:
- Colors: 12 custom colors in theme.extend.colors
- Spacing: 6 custom values in theme.extend.spacing
- Font families: 2 custom fonts

Does this look complete, or are there additional token sources I should check?
```

**Tier 3 (guided):** Ask the user for token values or point to export files.

**Cross-source reconciliation:** If tokens come from multiple sources (e.g., Tailwind config + CSS custom properties), reconcile:
- Same token, same value → merge (note both sources)
- Same token, different values → flag as conflict, ask user which is authoritative
- Token only in one source → include, note source

### Phase 3: Semantic Translation

Convert raw extracted values into the dual-format convention (prose + structured table):

1. **Name each token semantically** — not `gray-500` but `"Soft Warm Gray"` with functional role. If DESIGN_MEMORY.md exists, reuse prior semantic names for consistency.
2. **Detect patterns** — is the spacing scale linear (4/8/12/16) or exponential (4/8/16/32)? Is the type scale based on a ratio (1.25 Major Third)?
3. **Group by function** — not by source file. All colors together, all spacing together.
4. **Write the atmosphere description** — if design-partner direction exists, draw from it. Otherwise, infer from the token values (warm neutrals → "warm and approachable"; high contrast + tight spacing → "dense and utilitarian").

### Phase 4: DESIGN.md Generation

Write DESIGN.md following the canonical schema (schema_version: 1):

1. YAML frontmatter (schema_version, project, extracted_from, extracted_at, framework, styling)
2. All required sections: Visual Theme & Atmosphere, Color Palette & Roles, Typography Rules, Spacing & Layout, Accessibility Constraints, Source Mapping
3. Applicable optional sections based on what was extracted
4. Each section: prose description above, markdown table below (dual-format rule)

**Accessibility Constraints:** Compute WCAG contrast ratios for text color / background color pairs where possible. Flag any pair below 4.5:1.

**Source Mapping:** Record every source file, what was extracted from it, and the extraction tier used.

**Design Memory Notes:** Include a proposed DESIGN_MEMORY.md entry documenting new or changed semantic names, token roles, source authority decisions, and unresolved conflicts.

### Phase 5: Critic Handoff

Present execution summary and recommend review:

```
## Execution Summary

**Input:** [framework] project with [styling system] tokens
**Artifacts generated:** 1 file (DESIGN.md)
**Output location:** ./DESIGN.md
**Confidence:** [HIGH if all Tier 1 / MEDIUM if Tier 2 involved / LOW if Tier 3]
**Deviations:** [count or "None"]

Review with: /design-token-critic ./DESIGN.md
```

If DESIGN_MEMORY.md exists, append a session entry documenting what was extracted/updated.

## Hard Gates
- No DESIGN.md generation without preflight detection (Phase 1)
- No DESIGN.md generation without Reference Inventory and source authority notes
- No Tier 2/3 extraction without user confirmation of detected values
- No delivery without Source Mapping section (provenance is mandatory)
- No delivery without Accessibility Constraints section (contrast ratios must be documented)
- No delivery without Design Memory Notes when DESIGN_MEMORY.md exists or new durable token decisions were made
- No public reference copying

## Required Output Contract

These headings are load-bearing:
- `## Preflight Detection Results`
- `## Reference Inventory`
- `## Token Extraction Summary`
- `## Generated Files`
- `## Design Memory Notes`
- `## Deviation Log`
- `## Execution Summary`
