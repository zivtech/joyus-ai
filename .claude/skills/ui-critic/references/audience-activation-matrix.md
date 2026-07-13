# UI Critic Audience Activation Matrix

Inherits from shared-design-core/references/shared-audience-activation-matrix.md.

All shared core perspectives are always active. This file documents additional critic-specific activation rules.

## Critic-Specific Overrides

### Accessibility (Enhanced for Critic Mode)
In critic mode, accessibility checks are mandatory and cannot be downgraded:
- Run full WCAG 2.1 AA audit against contrast, keyboard, screen reader, and motion dimensions.
- NEVER downgrade accessibility findings during Realist Check.
- Flag any color-only information encoding as BLOCKS_USE.

### Performance Perception
Activate when:
- Interface has dynamic content loading, infinite scroll, or complex animations.
- Page load or interaction response time is observable in screenshots or code.

Must-check prompts:
- Are skeleton/loading states present and well-designed?
- Do animations serve a purpose or just delay interaction?
- Is perceived performance optimized (progressive rendering, optimistic UI)?

## Realist Check Rules (Critic-Specific)
When running the Realist Check on BLOCKS_USE / IMPAIRS_USE findings:
1. NEVER downgrade: accessibility barriers, data loss risks, or safety issues.
2. Edge case affecting <5% of users with easy workaround → downgrade one level.
3. Mitigating factors substantially limit impact → downgrade one level.
4. Every downgrade MUST include a "Mitigated by: ..." statement.
5. Fast detection + straightforward fix → note context but keep severity.
