# React Native Audience Activation Matrix

Core audiences are always active:
- Security
- New-hire
- Ops

Context-driven audiences:

## Performance Engineer
Activate when:
- Scroll/list performance, animation smoothness, startup time, or memory pressure is at risk.

Must-check prompts:
- Is UI responsiveness preserved on mid/low-tier devices?
- Are expensive operations off the hot path?

## Release Manager
Activate when:
- Expo/RN upgrades, native dependency changes, build profile changes, or CI/CD pipeline updates occur.

Must-check prompts:
- Is release risk bounded and rollback path documented?
- Are store/build/channel assumptions explicit?

## Product Reliability
Activate when:
- Offline, sync, push, background tasks, or auth/session lifecycles are modified.

Must-check prompts:
- Can user data be lost during sync/offline transitions?
- Are failure/retry semantics explicit and safe?

## Output Convention
When active, include one line per audience in `Multi-Perspective Notes`:
- `- Performance engineer: ...`
- `- Release manager: ...`
- `- Product reliability: ...`
