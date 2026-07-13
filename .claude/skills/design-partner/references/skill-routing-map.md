# Design Partner Skill Routing Map

Core:
- anthropics/skills/frontend-design

Design system:
- wshobson/agents/tailwind-design-system

Documentation:
- google-labs-code/stitch-skills/design-md

Accessibility (proactive):
- addyosmani/web-quality-skills/accessibility

Standards:
- vercel-labs/agent-skills/web-design-guidelines
- supercent-io/skills-template/web-accessibility

Rules:
- Load max 3 skills: 1 core + up to 2 contextual.
- Always load core (anthropics/skills/frontend-design) — anti-generic aesthetic direction.
- Load tailwind-design-system when building components or establishing design tokens.
- Load design-md when documenting or extracting design decisions from existing code.
- Load addyosmani/accessibility when building new interactive components.
- Load web-design-guidelines when checking work against published interface standards.

Downstream handoff:
- When design direction is set and the user needs rapid visual prototypes via Google Stitch, hand off to `stitch-planner` with the Design Direction Handoff section.
- When design direction is set and the user needs implementation-ready web architecture, hand off to `web-design-planner`.
