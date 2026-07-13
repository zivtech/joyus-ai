---
name: graphic-design-executor
type: executor
description: "Execute graphic design implementations from graphic-design-planner specs."
version: 0.1.0
---

# Graphic Design Executor Skill

## When to Use

**Primary triggers:**
- "generate these social media assets", "build brand guidelines", "create presentation graphics"
- "execute this graphic design plan", "generate assets from this spec"
- User has a graphic-design-planner spec and wants SVG/HTML graphic assets
- User describes a graphic asset and wants production-ready output

---

## Do Not Use When

- You need a **data-driven infographic** — use `infographic-executor`
- You need a **web page** — use `web-design-executor`
- You need to **design** first — use `graphic-design-planner`
- You need to **review** existing assets — use `graphic-design-critic`
- You need a **slide deck** — use `marp-executor`

---

## Resolution Paths

| Situation | Route |
|-----------|-------|
| Have graphic-design-planner spec for social/brand assets | This skill |
| Need a data visualization infographic | Use `infographic-executor` |
| Need a web page | Use `web-design-executor` |
| Need a slide deck | Use `marp-executor` |
| Need to design first | Use `graphic-design-planner`, then come back |

---

## What You Get

- **Social media asset packs:** Multi-format SVG/HTML (1:1 square, 16:9 landscape, 9:16 stories, 1200x628 OG image)
- **Brand guideline pages:** Logo usage, color swatches, typography specimens, spacing rules as structured HTML/SVG
- **Presentation graphics:** Title cards, section headers, data callouts as SVG components
- **Design tokens as CSS custom properties** applied consistently across all assets
- **Self-contained HTML files** with embedded SVG — no external dependencies

---

## Scope (v1)

**In scope:** Social media packs, brand guideline pages, presentation graphics.
**Deferred to v2:** Print-ready PDF with bleed/crop marks, CMYK color profiles, multi-page print layouts.

---

## Shared Research Reference

Apply the shared research-backed workflow while executing:
`design-skills/shared-design-core/.claude/skills/shared-design-core/references/research-backed-design-workflow.md`

## Research-Backed Execution Preflight

Before generating assets:
- Read the graphic-design-planner spec when present, including `Reference Inventory`, `Design Memory Notes`, asset matrix, and `Source/Provenance Notes`.
- Read DESIGN.md and DESIGN_MEMORY.md when present. Preserve token names, semantic roles, visual rationale, and rejected directions unless the user requests a change.
- If the input came directly from the user, create a compact reference inventory, style vocabulary, asset matrix, and production State Matrix before generating assets.
- Translate public references into local design principles only. Do not copy public reference screenshots, branded assets, prompt bodies, layouts, or illustration styles.
- Use local verification by default: dimensions, safe zones, contrast, legibility at target size, overflow/clipping, export format checks, and channel simulation where possible. Do not use Anthropic API for benchmark execution unless explicitly overridden by the user.

---

## Execution Protocol

### Phase 1 — Input Validation & Parameter Extraction

1a. Detect Input Mode:

| Mode | Detection | Behavior |
|------|-----------|----------|
| **Planner spec** | Input contains: Asset Type, Visual Direction, Brand Tokens, Format Requirements, Content Inventory | Parse and extract all parameters |
| **Direct request** | User describes a graphic asset ("social media pack for product launch") | For simple assets (single type): proceed with sensible defaults. For campaign systems: recommend `graphic-design-planner` first |

1b. Extract Parameters:
- **Asset type:** Social pack / brand guideline / presentation graphic / campaign set
- **Brand tokens:** Colors (primary, secondary, accent), fonts, logo reference
- **Format requirements:** Sizes, aspect ratios, export targets
- **Content inventory:** Headlines, body copy, image references, CTAs
- **Visual direction:** Style, mood, composition notes from planner spec
- **Reference/provenance:** Project-local sources, user references, research-only references, and missing evidence
- **Design memory:** Prior decisions to preserve and new decisions to propose

1c. Validate Completeness:
- No asset type identifiable → STOP
- No brand colors → use neutral palette and flag in Deviation Log
- No content → STOP (cannot generate graphics without content)

### Phase 2 — Environment & Dependency Check

2a. Verify context: standalone assets or part of existing brand system?
2b. Determine output location: `~/.agent/artifacts/YYYY-MM-DD-<asset-name>/`
2c. Collision detection: check for existing files.

### Phase 3 — Asset Generation

3a. Brand Token Extraction:
- Generate CSS custom properties for all brand tokens
- Color swatches as SVG rects with labels
- Typography specimens as styled text blocks
- Spacing grid as visual reference

3b. Layout Composition:
- SVG viewBox setup per format size
- Grid system for content placement
- Safe zones for text (10% margin from edges on social)
- Visual hierarchy: dominant element, supporting elements, accent

3c. Content Placement:
- Headlines: largest type, highest contrast, top or center placement
- Body copy: readable size (≥14px equivalent), sufficient contrast
- Image placeholders: aspect-ratio-correct containers with description
- CTAs: high-contrast buttons or text links
- Logo: consistent placement per brand guidelines

3d. Multi-Format Export (social packs):
- Generate each specified size as a separate SVG within HTML
- Maintain visual hierarchy across all formats
- Adapt layout per aspect ratio (don't just crop — recompose)
- Include format label in filename

### Phase 4 — Quality Self-Check

4a. Brand Consistency:
- All colors from brand token custom properties (no hardcoded hex)
- Fonts match brand specification
- Logo placement follows brand guidelines (if specified)

4b. Production Readiness:
- Social assets: correct dimensions for each platform
- Text legible at intended display size
- Sufficient contrast (WCAG AA minimum for text)
- No text overflow or clipping

4c. Visual Hierarchy:
- Clear dominant element per asset
- Information scannable in 3 seconds
- CTA visible and distinct

4d. Deviation Log:
| # | Spec Requirement | What Was Generated | Reason |

4e. Design Memory Notes:
- Proposed DESIGN_MEMORY.md entry for durable concept, typography, color, layout, asset-system, or export decisions introduced by execution.

4f. Confidence Rating: HIGH / MEDIUM / LOW

### Phase 5 — Output & Critic Handoff

5a. Write HTML/SVG files.
5b. Execution Summary.
5c. Critic Handoff:
```
Ready for review? Run:
/graphic-design-critic [path-to-assets]
```

---

## Hard Gates

- Social assets must include all specified format sizes
- No asset without brand token application (colors from CSS custom properties)
- No asset without clear visual hierarchy
- No text below WCAG AA contrast minimum
- No text overflow in fixed containers
- No asset without Reference Inventory, production State Matrix, Source/Provenance Notes, and Design Memory Notes
- No delivery without local production verification results or an explicit limitation statement
- No asset that copies public reference assets or branded visual systems

---

## Required Output Contract

Use these top-level headings exactly:
- `## Parameter Extraction`
- `## Reference Inventory`
- `## Generated Files`
- `## Implementation Preview`
- `## Verification Notes`
- `## Design Memory Notes`
- `## Deviation Log`
- `## Execution Summary`
