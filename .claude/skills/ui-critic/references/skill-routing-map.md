# UI Critic Skill Routing Map

Core:
- github/awesome-copilot/web-design-reviewer

Accessibility specialists:
- addyosmani/web-quality-skills/accessibility
- webflow/webflow-skills/accessibility-audit

Standards compliance:
- vercel-labs/agent-skills/web-design-guidelines

Responsive specialist:
- wshobson/agents/responsive-design

Rules:
- Load max 3 skills: 1 core + 1 accessibility + 1 contextual specialist.
- Always load core (web-design-reviewer).
- Always load addyosmani/accessibility for any design review.
- Load web-design-guidelines when checking against published standards.
- Load webflow/accessibility-audit for deep structural accessibility audits.
- Load responsive-design when mobile or responsive behavior is under review.
