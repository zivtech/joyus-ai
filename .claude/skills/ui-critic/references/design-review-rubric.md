# UI Critic Design Review Rubric

Evaluation dimensions specific to the harsh design critique mode.

## Nielsen's 10 Usability Heuristics (Score each 0–4)
0 = No issues found. 1 = Cosmetic only. 2 = Minor usability issue. 3 = Major usability issue. 4 = Usability catastrophe.

1. **Visibility of system status** — Does the system keep users informed through timely feedback?
2. **Match between system and real world** — Does the interface use language and concepts familiar to the user?
3. **User control and freedom** — Can users easily undo, redo, and exit unwanted states?
4. **Consistency and standards** — Does the interface follow platform conventions and internal patterns?
5. **Error prevention** — Does the design prevent errors before they occur?
6. **Recognition rather than recall** — Are options, actions, and information visible or easily retrievable?
7. **Flexibility and efficiency of use** — Can expert and novice users both work efficiently?
8. **Aesthetic and minimalist design** — Is every element necessary and purposefully placed?
9. **Help users recognize, diagnose, and recover from errors** — Are error messages helpful and actionable?
10. **Help and documentation** — Is help available, searchable, and task-focused?

## Severity Scale
- **BLOCKS_USE**: Prevents task completion for a significant user segment. Requires fix before ship.
- **IMPAIRS_USE**: Degrades experience meaningfully but workaround exists. Fix in current cycle.
- **FRICTION**: Noticeable roughness that slows users. Schedule for near-term polish.
- **POLISH**: Taste-level improvement. Nice to have.

## Design-Specific Must-Check List
- [ ] Information hierarchy and visual prioritization
- [ ] Interaction states (hover / focus / active / disabled) for all interactive elements
- [ ] Responsive behavior at 375px / 768px / 1280px / 1920px
- [ ] Loading, empty, and error states
- [ ] WCAG 2.1 AA contrast ratios (4.5:1 normal text, 3:1 large text/UI components)
- [ ] Keyboard navigation and focus management
- [ ] Touch target sizing (44×44px minimum on mobile)
- [ ] Color independence (information not conveyed by color alone)
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Design system consistency (tokens, patterns, naming)

## Browser Testing Requirements
- All reviews MUST be conducted in an actual browser, not from static screenshots alone.
- The reviewer must scroll through the page as a human would — top to bottom, at a natural reading pace — and evaluate what is visible in each viewport position.
- Humans do not see pages all at once. The review must reflect progressive discovery, scroll-dependent content hierarchy, and viewport-specific layout behavior.
- Test interactions: hover, focus, click, form fill, keyboard navigation. Don't just look — use it.
- Test at 375px, 768px, 1280px, and 1920px. Actually resize and re-scroll at each.
- If browser testing is not possible (static mockup only), explicitly state this limitation and mark the review as incomplete.

## Evidence Requirements
- Every BLOCKS_USE or IMPAIRS_USE finding must cite a specific UI element, screenshot region, code location, or interaction pattern.
- Uncertain findings go to Open Questions, not scored sections.
- Taste-only preferences go to POLISH, never to BLOCKS_USE or IMPAIRS_USE.
