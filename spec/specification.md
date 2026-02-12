# Specification: Presentation Toolkit MVP

**Project:** Zivtech AI Agent Platform
**Phase:** 4 — Additional Tools (Presentation Toolkit)
**Date:** January 29, 2026 (Phase renumbered Feb 11, 2026)
**Status:** Specification Complete

---

## 1. MVP Scope

### Primary Use Case: Rebrand Existing Deck

Take an existing PowerPoint presentation and rebrand it with new visual identity while preserving all content.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Source Deck    │     │   Brand Assets  │     │  Rebranded Deck │
│  (PPT/PPTX)     │ ──▶ │  (varies)       │ ──▶ │  (PPTX)         │
│                 │     │                 │     │                 │
│  • Old branding │     │  • Colors       │     │  • New branding │
│  • All content  │     │  • Fonts        │     │  • All content  │
│  • Any size     │     │  • Logos        │     │  • Good layout  │
└─────────────────┘     │  • Templates    │     └─────────────────┘
                        └─────────────────┘
```

### MVP Users

- **Zivtech staff only** — invoked as a Claude Code/Cowork skill
- No client-facing UI or self-service access in MVP
- Client-facing access deferred to after Phase 3 (Platform Framework) when the web app exists

### Out of Scope (Toolkit MVP)

- Client self-service access
- Content generation from Word/PDF (future iteration)
- Creating decks from scratch
- Real-time collaboration
- Web-based interface

---

## 2. Inputs

### Source Deck (Required)

| Format | Support Level |
|--------|---------------|
| .pptx | Full support |
| .ppt | Convert to .pptx first |

**Content to preserve:**
- All text (titles, body, bullets, tables)
- Images and graphics
- Charts and data visualizations
- Slide notes
- Slide order and structure

### Brand Assets (Required)

Clients provide brand assets in varying formats. Tool must handle:

| Input Type | What We Extract |
|------------|-----------------|
| **PPT Template (.potx/.pptx)** | Master slides, layouts, color scheme, fonts |
| **Brand Guidelines (PDF)** | Colors (hex), font names, logo placement rules |
| **Individual Assets** | Logo files, color palette, font files |

**Minimum required:**
- Primary brand color
- Logo file (PNG/SVG)
- Font preference (or fallback to system fonts)

---

## 3. Outputs

### Format

- **Editable PPTX** — Required, non-negotiable
- Clients always need ability to make their own tweaks
- PDF export is secondary (nice-to-have)

### Quality Bar

**Target: 80% ready**
- Saves significant time over manual rebranding
- Minor manual fixes acceptable
- Should NOT require rebuilding slides from scratch

### Must Achieve

| Requirement | Description |
|-------------|-------------|
| **Content integrity** | Zero content loss — all text, images, data preserved |
| **Brand application** | Colors, fonts, logos applied consistently |
| **Reasonable layout** | Visual hierarchy maintained, no bizarre spacing |
| **File validity** | Output opens correctly in PowerPoint, no corruption |

### Failure Handling

- **Unprocessable slides** (SmartArt, embedded video, heavily layered graphics): Skip the slide and insert a placeholder slide noting it requires manual work. Never abort the entire deck.
- Output must always include a summary of skipped/flagged slides so the user knows what needs attention.

### Acceptable Imperfections

- Minor alignment tweaks needed
- Occasional font substitution warnings
- Some manual logo repositioning
- Complex charts may need touch-up
- Placeholder slides for unprocessable content (see Failure Handling above)

---

## 4. Current Problems to Solve

Based on issues with existing toolkit (`claude-presentation-toolkit`):

### P1: Wrong Layout Choices (Critical)

**Symptoms:**
- Content placed poorly on slides
- Bad visual hierarchy
- Weird spacing and alignment
- Text overlapping elements

**Root causes to investigate:**
- Layout selection logic
- Spatial reasoning for element placement
- Template/master slide usage

### P2: Lost/Mangled Content (Critical)

**Symptoms:**
- Text missing entirely
- Bullets merged or reordered
- Tables broken or flattened
- Images dropped

**Root causes to investigate:**
- Content extraction pipeline
- Structure preservation during transformation
- Edge cases in complex slides

### P3: Template Not Respected (High)

**Symptoms:**
- Master slides ignored
- Layout placeholders not used
- Brand colors not applied to correct elements

**Root causes to investigate:**
- Template parsing logic
- Master slide / layout mapping
- Color scheme application

### P4: Inconsistent/Unreliable Output (High)

**Symptoms:**
- Same input produces different results
- Errors on certain decks
- Incomplete processing

**Root causes to investigate:**
- Error handling
- Edge case coverage
- State management

---

## 5. Technical Approach

### Processing Model: Hybrid (Extract-All, Rebrand-Per-Slide)

**Phase 1 — Full-deck extraction:** Parse the entire source deck upfront to build a complete content model. This gives the rebranding phase full context for cross-slide layout decisions (e.g., consistent heading levels, recurring layouts, section grouping).

**Phase 2 — Per-slide rebranding:** Process each slide individually against the full content model. Failures on one slide do not block others (see Failure Handling in Section 3).

### Content Extraction (Phase 1 — runs on full deck)

```
Source PPTX
    │
    ▼
┌─────────────────────────────────────┐
│  Extract Slide Structure            │
│  • Parse XML (via python-pptx)      │
│  • Build content tree per slide     │
│  • Preserve hierarchy and order     │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Structured Content Representation  │
│  (Semantic Block Model)             │
│  • Typed blocks: heading, bullets,  │
│    table, image, chart              │
│  • Position hints (x, y, w, h)     │
│  • Hierarchy (parent/child)         │
│  • Slide type classification        │
│  • Full-deck context available      │
└─────────────────────────────────────┘
```

### Brand Application

```
Brand Assets + Content Structure
    │
    ▼
┌─────────────────────────────────────┐
│  Brand Normalization                │
│  • Extract colors → palette         │
│  • Map fonts → available fonts      │
│  • Process logo → placement rules   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Template Mapping                   │
│  • Match content to layouts         │
│  • Apply master slides              │
│  • Inject brand elements            │
└─────────────────────────────────────┘
```

### Output Generation

```
Branded Content + Template
    │
    ▼
┌─────────────────────────────────────┐
│  PPTX Assembly                      │
│  • Build slides using python-pptx   │
│  • Apply layouts from template      │
│  • Position elements correctly      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Validation                         │
│  • Content completeness check       │
│  • File integrity verification      │
│  • Claude visual review (see below) │
└─────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| PPTX parsing | python-pptx | Mature, full XML access |
| Orchestration | Claude (via skill) | Content understanding, layout decisions |
| Brand extraction | Custom + Claude | Structured extraction from varied formats |
| Output assembly | python-pptx | Direct PPTX generation |
| Validation | Custom + Claude vision | Content diffing, file checks, visual review |
| Slide rendering | python-pptx → PNG (via LibreOffice or similar) | Render slides for Claude visual scoring |

---

## 6. Success Criteria

### MVP Complete When

1. **Rebrand workflow works end-to-end**
   - Input: existing PPTX + brand assets
   - Output: rebranded PPTX

2. **Content integrity verified**
   - Automated check: all text preserved
   - Manual spot-check: images, tables, charts intact

3. **Brand applied correctly**
   - Colors match brand palette
   - Fonts applied (or acceptable fallback)
   - Logo placed appropriately

4. **Tested on real decks**
   - Minimum 5 real client decks processed
   - 80% quality bar achieved on each

5. **Packaged as skill**
   - Works in Claude Code and Cowork
   - Clear usage instructions
   - Error handling for common issues

---

## 7. Open Questions

| Question | Impact | Resolution Path |
|----------|--------|-----------------|
| ~~What's the content structure schema?~~ | ~~High~~ | **Resolved:** Semantic blocks — typed content blocks (heading, bullets, table, image, chart) with position hints and hierarchy |
| How to handle complex charts? | Medium | Test with real examples |
| Font fallback strategy? | Medium | Define mapping rules |
| ~~How to validate "good layout"?~~ | ~~High~~ | **Resolved:** Claude visual review — render slides as images, score against heuristics |
| ~~Slide-by-slide or whole-deck processing?~~ | ~~Medium~~ | **Resolved:** Hybrid — extract all first, rebrand slide-by-slide |

---

## 8. Next Steps

1. **Diagnose current toolkit** — Get repo access, identify specific failures
2. **Design content schema** — How to represent extracted slide content
3. **Build extraction pipeline** — Robust content extraction from PPTX
4. **Build assembly pipeline** — Content + brand → output PPTX
5. **Test with real decks** — Iterate on quality issues

---

## Clarifications

### Session 2026-02-12

- Q: When the toolkit hits a slide it can't cleanly extract or rebrand, what should it do? → A: Skip the problem slide and include a placeholder noting it needs manual work.
- Q: Should the toolkit process slide-by-slide, whole-deck, or hybrid? → A: Hybrid — extract all content first (full deck context for layout decisions), then rebrand slide-by-slide (error isolation, lower peak memory).
- Q: Who invokes the Presentation Toolkit for the MVP? → A: Zivtech staff only, via Claude Code/Cowork skill. No client-facing UI for MVP.
- Q: How should the toolkit validate layout quality? → A: Claude visual review — render slides as images, have Claude score them against heuristics (overlap, hierarchy, spacing, brand compliance).
- Q: What granularity for the content structure schema? → A: Semantic blocks — typed content blocks (heading, bullets, table, image, chart) with position hints and hierarchy.

---

*Specification captured: January 29, 2026*
*Interview conducted with: Alex UA*
*For: Zivtech AI Agent Platform — Phase 4 (Presentation Toolkit)*
