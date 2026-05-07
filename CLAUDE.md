# Joyus AI Platform

Multi-tenant AI agent platform. Open source core + private client/org skills. Skills as encoded organizational knowledge with monitoring for usage and content fidelity.

## Client Abstraction Rule (Constitution §2.10)

**This is a hard constraint for all work on this project.**

Alex will discuss specific client needs during planning. Your job is to **abstract those into general platform capabilities**:
- "Client X needs 5 audience voices" → platform supports N configurable audience voices
- "Client Y tracks CFPB regulations" → platform supports pluggable regulatory monitoring
- Never embed client names, real person names, client-specific terminology, or domain-specific jargon into any artifact in this repo (specs, code, tests, fixtures, examples, comments)
- Use fictional/generic examples: "Author A", "the compliance department", "Example Corp", "Formal (Courts)", "Technical (Practitioners)"
- **The test**: Could a stranger identify which client inspired this? If yes, it doesn't belong here.
- Client-specific content goes in private repos (`<org>-skills`, `<client>-deploy`)
- **Generalize at the point of creation** — don't write client-specific content and sanitize later

## Account Separation

| Account | Primary Use |
|---------|-------------|
| **Teams (Claude Code)** | Technical execution, coding |
| **Personal (Cowork)** | Business planning, strategy, Milk Jawn, proposals |

## Git Conventions

- Follow `CONTRIBUTING.md` commit message conventions.
- Use standard Conventional Commits: `<type>(<scope>): <short summary>`.
- Use the body to explain why the change was made when helpful.
- Reference GitHub issues in the body or footer when relevant.
- Do not add Lore-style decision trailers such as `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, or `Directive:` unless a human explicitly asks for them.
