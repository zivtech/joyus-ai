# Next.js Audience Activation Matrix

Core audiences are always active:
- Security
- New-hire
- Ops

Context-driven audiences:

## Performance Engineer
Activate when:
- Cache, revalidate, PPR, streaming, or runtime decisions are changed.

Must-check prompts:
- Is cache behavior deterministic and scoped correctly?
- Could this create stale-data or over-invalidation regressions?

## DX Maintainer
Activate when:
- Next.js version upgrades, App Router migrations, or major route structure changes appear.

Must-check prompts:
- Is migration effort and rollback clearly documented?
- Is the resulting structure maintainable for future changes?

## Product Reliability
Activate when:
- Personalized or transaction-like user journeys depend on server/client boundary behavior.

Must-check prompts:
- Could boundary mistakes break session or user-specific data correctness?
- Are fallback and error boundaries sufficient for real production failures?

## Output Convention
When active, include one line per audience in `Multi-Perspective Notes`:
- `- Performance engineer: ...`
- `- DX maintainer: ...`
- `- Product reliability: ...`
