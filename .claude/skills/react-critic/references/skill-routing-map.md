# React Critic Skill Routing Map

Core (always loaded):
- vercel-labs/agent-skills/vercel-react-best-practices — core React performance and component design patterns from Vercel

Specialists (load one based on context):
- wshobson/agents/react-state-management — when code touches state management (Redux, Zustand, Context, atoms)
- wshobson/agents/react-modernization — when reviewing React version upgrades or migration paths
- millionco/react-doctor/react-doctor — when investigating rendering performance or anti-patterns
- dotneet/claude-code-marketplace/typescript-react-reviewer — when reviewing TypeScript + React type safety and API design

Shared support (load one):
- wshobson/agents/javascript-testing-patterns — when reviewing test strategy or coverage gaps
- github/awesome-copilot/javascript-typescript-jest — when reviewing Jest test implementations
- wshobson/agents/modern-javascript-patterns — when reviewing modern JS idioms and async patterns
- sickn33/antigravity-awesome-skills/api-security-best-practices — when code handles API boundaries or sensitive data

Rules:
- Load max 3 skills: 1 core + 1 specialist + 1 shared support.
