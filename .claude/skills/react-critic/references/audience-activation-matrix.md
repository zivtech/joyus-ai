# React Audience Activation Matrix

Core audiences are always active:
- Security
- New-hire
- Ops

Context-driven audiences:

## Performance Engineer
Activate when:
- Slow rendering, expensive list/table rendering, hydration lag, or bundle size concerns appear.
- Complex memoization or derived state logic is introduced.

Must-check prompts:
- Is rendering work bounded and observable?
- Could this design create avoidable re-renders or waterfalls?

## DX Maintainer
Activate when:
- Major refactors, React version upgrades, or architecture migrations are involved.

Must-check prompts:
- Can a new engineer modify this safely?
- Are migration assumptions and rollback paths explicit?

## Product Reliability
Activate when:
- Stateful user journeys (checkout, onboarding, form-heavy flows) are affected.

Must-check prompts:
- Can user state be lost or silently corrupted?
- Are error and retry paths user-safe?

## Output Convention
When active, include one line per audience in `Multi-Perspective Notes`:
- `- Performance engineer: ...`
- `- DX maintainer: ...`
- `- Product reliability: ...`
