# Next Critic Skill Routing Map

Core (always loaded):
- vercel-labs/next-skills/next-best-practices — core Next.js App Router patterns and data fetching from Vercel

Specialists (load one based on context):
- vercel-labs/next-skills/next-cache-components — when reviewing caching, ISR, or revalidation behavior
- vercel-labs/next-skills/next-upgrade — when reviewing Next.js version upgrades or migrations
- wshobson/agents/nextjs-app-router-patterns — when reviewing advanced App Router architecture patterns
- wsimmonds/claude-nextjs-skills/nextjs-app-router-fundamentals — when reviewing basic App Router component structure

Auth conditional (load when auth imports detected):
- clerk/skills/clerk-nextjs-patterns — when Clerk imports are present
- auth0/agent-skills/auth0-nextjs — when Auth0 imports are present
- mindrally/skills/nextauth-authentication — when NextAuth.js / Auth.js imports are present

Shared support (load one):
- wshobson/agents/javascript-testing-patterns — when reviewing test strategy or coverage gaps
- wshobson/agents/modern-javascript-patterns — when reviewing modern JS idioms and async patterns
- sickn33/antigravity-awesome-skills/api-security-best-practices — when code handles API boundaries or sensitive data

Rules:
- Load max 3 skills: 1 core + 1 context specialist + 1 shared support.
- App Router-first guidance by default.
