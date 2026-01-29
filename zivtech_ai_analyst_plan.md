# Zivtech AI Analyst — Project Plan

**Version:** 1.1  
**Date:** January 29, 2026  
**Status:** Ready to Initialize  
**Notion:** [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)

---

## Executive Summary

Build a Manus-style agent using **Claude for orchestration + Gemini 3 Pro Image for design outputs**, focused on Zivtech consulting deliverables:

- Migration roadmaps
- Architecture diagrams
- Gap analysis visualizations
- Client-ready presentations

**Key Insight:** Manus's quality comes from *iterative feedback loops*, not single-shot generation. Our architecture mirrors this with an observe-think-verify pattern.

**Target Outcome:** Consultants can feed in system audits, interview transcripts, or requirements docs and get polished, client-ready visual deliverables with minimal manual refinement.

---

## Background Research

### What Makes Manus Special

Manus's design quality comes from three pillars:

1. **Nano Banana Pro** (Google's Gemini 3 Pro Image)
   - Studio-quality visual outputs with legible text
   - 4K resolution support
   - "Thinking mode" for complex compositions

2. **Research-first architecture**
   - Agent researches topics before designing
   - Pulls verifiable data and citations into outputs
   - Content quality drives design quality

3. **Sophisticated context engineering** (from their July 2025 blog)
   - KV-cache optimization (10x cost reduction)
   - Token logit masking for constrained tool selection
   - File-system-as-memory pattern
   - `todo.md` "recitation" for attention manipulation
   - Error preservation for implicit learning

### Market Context

- **Meta Acquisition (Dec 2025):** Meta acquired Manus, changing build vs. buy calculus
- **Competitive Landscape:** Gamma, Plus AI, Beautiful.ai all use HTML/CSS templates — Manus uses generated images, which is why they look more polished
- **Zivtech Opportunity:** Specialized agent for consulting deliverables is underserved

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLAUDE ORCHESTRATOR                         │
│  (Claude Agent SDK - reasoning, planning, quality control)      │
└─────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│   RESEARCH    │  │    CONTENT      │  │      DESIGN         │
│   Web search  │  │   Structuring   │  │  Gemini 3 Pro Image │
│   Doc analysis│  │   Outline gen   │  │  4K slide images    │
└───────────────┘  └─────────────────┘  └─────────────────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │   VISION FEEDBACK   │
                                    │   Claude critiques  │
                                    │   Loop if needed    │
                                    └─────────────────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │      OUTPUT         │
                                    │  PPTX / PDF / Images│
                                    └─────────────────────┘
```

### Vision Feedback Loop (Core Innovation)

**Core Insight:** Manus's quality doesn't come from better single-shot vision — it comes from **tight iterative feedback loops**. Generate → Critique → Refine → Repeat.

#### The Observe-Think-Verify Pattern

```
┌─────────────────────────────────────────────────────────────┐
│  1. GENERATE                                                │
│     Claude creates prompt → Gemini generates image          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  2. OBSERVE                                                 │
│     Claude describes what it sees (factual, no judgment)    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  3. THINK                                                   │
│     Claude reasons about quality against criteria:          │
│     - Text legibility (font size, contrast, spacing)        │
│     - Visual hierarchy (what draws attention first?)        │
│     - Color harmony (complement or clash?)                  │
│     - Information density (sparse vs. crowded)              │
│     - Professional polish (alignment, consistency)          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  4. VERIFY                                                  │
│     Compare output to original intent/spec                  │
│     Does it meet the quality threshold?                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
              ┌───────────────────────┐
              │  Quality OK?          │
              └───────────────────────┘
               │ YES              │ NO
               ↓                  ↓
         [OUTPUT]           [REFINE & LOOP]
                            Generate new prompt
                            with specific fixes
```

#### Vision Implementation Strategies

**1. Multi-Pass Analysis**
Instead of one prompt, use sequential analysis:
- Pass 1: "Describe what you see at a high level"
- Pass 2: "Focus on text/typography - what do you read?"
- Pass 3: "Analyze layout and spatial relationships"
- Pass 4: "Identify issues with visual hierarchy"

**2. Structured Critique Rubrics**
Give Claude explicit evaluation criteria in system prompt.

**3. Reference Image Comparison**
Show Claude a "good" example alongside generated output:
```
[Reference image] - This is the quality standard
[Generated image] - This is what we produced
What specific differences do you notice?
```

**4. Image Preprocessing**
- Resize to ~1092×1092px (Claude's sweet spot)
- Ensure high contrast and clarity
- Place image BEFORE text in prompts
- Budget ~750 pixels per token for cost estimation

**5. Tool Augmentation Options**
Claude + specialized tools beats Claude alone:
- OCR tools for small text extraction
- Color extraction APIs for palette analysis
- Layout detection models for spatial precision

---

## Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Orchestrator | Claude Agent SDK | Anthropic's first-party agentic framework |
| Image Generation | Gemini 3 Pro Image API | "Nano Banana Pro" - studio quality |
| Research | Web search + document analysis | Built into orchestrator |
| Output Assembly | python-pptx or image-based | TBD based on research |
| Project Management | Spec Kitty | Spec-driven development |
| Development | Claude Code + Desktop MCP | Multi-context workflow |

---

## Work Packages

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP01 | Orchestrator Skeleton | Claude Agent SDK setup, basic tool routing | 2-3 days |
| WP02 | Research Tool Integration | Web search, document analysis tools | 2-3 days |
| WP03 | Content Structuring Pipeline | Input docs → structured outline | 3-4 days |
| WP04 | Gemini Image Integration | API setup, prompt templates, error handling | 3-4 days |
| WP05 | Output Assembly | PPTX/PDF generation from images | 2-3 days |
| WP06 | Zivtech Templates | Migration roadmap, architecture diagram templates | 3-4 days |
| WP07 | Vision Feedback Loop | Observe-think-verify with quality thresholds | 4-5 days |

**Total Estimated Effort:** 19-26 days (4-5 weeks with buffer)

### Work Package Details

#### WP01: Orchestrator Skeleton
- Initialize Claude Agent SDK project
- Define tool interface contracts
- Implement basic conversation loop
- Error handling and logging
- **Deliverable:** Working orchestrator that can route to stub tools

#### WP02: Research Tool Integration
- Web search tool (Anthropic's built-in or custom)
- Document analysis tool (PDF, DOCX parsing)
- Citation extraction and formatting
- **Deliverable:** Orchestrator can research topics and cite sources

#### WP03: Content Structuring Pipeline
- Input document parsing (multiple formats)
- Content extraction and summarization
- Outline generation for visual deliverables
- Slide/section planning
- **Deliverable:** System can turn raw docs into structured content plans

#### WP04: Gemini Image Integration
- Gemini 3 Pro Image API authentication
- Prompt template library for different visual types
- Rate limiting and retry logic
- Cost tracking
- **Deliverable:** System can generate images from structured prompts

#### WP05: Output Assembly
- Image → PPTX conversion (or image-based delivery)
- PDF generation option
- Consistent styling and branding
- **Deliverable:** Final deliverable files ready for client

#### WP06: Zivtech Templates
- Migration roadmap template
- Architecture diagram template
- Gap analysis visualization template
- Timeline/Gantt template
- **Deliverable:** 4+ reusable templates for common consulting deliverables

#### WP07: Vision Feedback Loop
- Implement observe-think-verify pattern
- Configurable quality thresholds
- Max iteration limits (default: 3)
- Critique → refinement prompt generation
- **Deliverable:** Iterative quality improvement system

---

## Development Workflow

### Using Spec Kitty

**Tool:** [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) - Spec-driven development framework

#### Why Spec Kitty for This Project
1. **Structured PRD creation** - `/spec-kitty.specify` forces clarity on WHAT before HOW
2. **Research phase built-in** - `/spec-kitty.research` for API investigation before coding
3. **Multi-agent coordination** - Supports Claude Code + other agents in parallel
4. **Kanban visibility** - Real-time dashboard shows progress
5. **Quality gates** - Accept/merge workflow prevents incomplete features

#### Spec Kitty Phases

**Phase 0: Project Setup**
```bash
spec-kitty init zivtech-ai-analyst --ai claude
cd zivtech-ai-analyst
```

**Phase 1: Constitution (`/spec-kitty.constitution`)**
Establish project principles:
- Claude as orchestrator, specialized tools as executors
- Client data never used for training (Tier 3/4 governance)
- Output quality standards (4K, professional typography)
- Cost targets (aim for 10-20% of full LLM processing cost)

**Phase 2: Specification (`/spec-kitty.specify`)**
Define WHAT to build:
- User stories for consultants generating deliverables
- Input types: system audits, interview transcripts, requirements docs
- Output types: migration roadmaps, architecture diagrams, presentations
- Discovery interview will force clarity on scope

**Phase 3: Planning (`/spec-kitty.plan`)**
Define HOW to build:
- Tech stack decisions
- Architecture: Orchestrator → Research → Content → Design pipeline
- Context engineering patterns from Manus
- Data model: Input documents → Structured content → Visual outputs

**Phase 4: Research (`/spec-kitty.research`)**
Investigate before coding:
- Gemini 3 Pro Image API (pricing, rate limits, enterprise access)
- Claude Agent SDK multi-tool patterns
- PPTX generation vs image-based slides tradeoffs
- Context window cost optimization

**Phase 5: Tasks (`/spec-kitty.tasks`)**
Break into work packages (see above)

**Phase 6: Implementation (`/spec-kitty.implement`)**
- Work in isolated worktree
- Kanban dashboard tracks progress
- Multi-agent: Claude Code for orchestrator, Cursor for UI

**Phase 7: Review/Accept/Merge**
- Quality gates verify all work packages complete
- Merge to main when feature ready

### Desktop MCP Integration

Since MCP is working on Desktop:
1. **Development**: Claude Desktop with MCP (Drive access, filesystem)
2. **Spec management**: Spec Kitty tracks specs/plans/tasks in repo
3. **Artifacts**: Persist via Drive MCP
4. **High-level tracking**: Notion for cross-project visibility

---

## Cost Model

### Per-Deliverable Estimates

| Component | Est. Cost | Notes |
|-----------|-----------|-------|
| Claude orchestration | $0.05-0.15 | ~5-10K tokens reasoning |
| Gemini image gen (×3 cycles) | $0.15-0.30 | 2-3 iterations per slide |
| Vision feedback (×3 cycles) | $0.03-0.06 | ~1.5K tokens per critique |
| **Per slide total** | **$0.23-0.51** | |
| **10-slide deck** | **$2.30-5.10** | |

### Cost Optimization Strategies

From Manus research:
- KV-cache optimization can achieve 10x cost reduction
- Token logit masking reduces unnecessary tool exploration
- File-system-as-memory avoids repeated context loading

**Target:** 10-20% of full LLM processing cost through smart routing

---

## Data Governance

### Tier Classification

| Tier | Data Type | Allowed Processing |
|------|-----------|-------------------|
| 1 | Public | Any tier |
| 2 | Internal | Commercial tier+ |
| 3 | Client Confidential | Enterprise plan |
| 4 | Ultra-Sensitive | Enterprise + ZDR |

### For This Project

- Client documents (system audits, requirements) = **Tier 3**
- Require Enterprise plan for production use
- Never use client data for model training
- All outputs must be reviewable before client delivery

---

## Open Research Questions

1. **Gemini 3 Pro Image API**
   - Pricing and rate limits for enterprise?
   - Batch processing support?
   - Fine-tuning or style transfer options?

2. **Output Format**
   - PPTX vs. image-based slides?
   - How do clients prefer to receive/edit?
   - Compatibility with existing Zivtech templates?

3. **Quality Thresholds**
   - How to define "good enough" programmatically?
   - What metrics correlate with client satisfaction?
   - Human-in-loop checkpoints?

4. **Context Engineering**
   - How to implement KV-cache optimization with Claude?
   - Token logit masking feasibility?
   - File-system-as-memory pattern in Claude Agent SDK?

---

## Timeline

### Phase 1: Foundation (Week 1-2)
- [ ] Initialize Spec Kitty project
- [ ] Complete constitution phase
- [ ] Run specification discovery interview
- [ ] Finalize plan and research phases

### Phase 2: Core Build (Week 3-4)
- [ ] WP01: Orchestrator skeleton
- [ ] WP02: Research tool integration
- [ ] WP03: Content structuring pipeline

### Phase 3: Visual Generation (Week 5-6)
- [ ] WP04: Gemini image integration
- [ ] WP07: Vision feedback loop
- [ ] WP05: Output assembly

### Phase 4: Templates & Polish (Week 7-8)
- [ ] WP06: Zivtech templates
- [ ] End-to-end testing
- [ ] Documentation
- [ ] Internal pilot with real project

---

## Success Criteria

1. **Quality:** Generated deliverables require <30 min manual polish
2. **Speed:** 10-slide deck in <10 minutes (vs. 2-4 hours manual)
3. **Cost:** <$10 per deck at production scale
4. **Adoption:** 3+ consultants using regularly within 2 months

---

## Next Actions

1. **Now:** Initialize Spec Kitty project
   ```bash
   spec-kitty init zivtech-ai-analyst --ai claude
   ```

2. **This week:** Complete constitution + specification phases

3. **Next week:** Plan + Research phases (API investigation)

4. **Following weeks:** Implementation per work packages

---

## References

- [Manus Architecture Blog (July 2025)](https://manus.ai/blog/architecture) - Context engineering patterns
- [Gemini 3 Pro Image Announcement](https://deepmind.google/technologies/gemini/) - "Nano Banana Pro"
- [Claude Agent SDK Docs](https://docs.anthropic.com/en/docs/agents) - Orchestration patterns
- [Spec Kitty GitHub](https://github.com/Priivacy-ai/spec-kitty) - Development framework
- [Notion: Technical Learning Questions](https://www.notion.so/9daf8c36a31342428e29c8958e1ba782) - Vision feedback loop research

---

*Document maintained in: `/mnt/user-data/outputs/zivtech_ai_analyst_plan.md`*  
*Notion canonical: [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)*
