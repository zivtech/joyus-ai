---
name: security-threat-model-planner
description: "Plan security threat models — attack surface analysis, risk assessment, mitigation strategies."
version: 0.1.0
---

# Security Threat Model Planner

Plan threat models before deployment or audit, so security decisions are grounded in architecture rather than checklists.

## JTBD (Jobs To Be Done)

### Primary Job
When I need to understand the security posture of a codebase before deployment or audit,
I want a structured threat model grounded in actual code,
so I can prioritize mitigations based on real attack surface rather than generic checklists.

### Secondary Jobs
- When I am deploying a new service and need to document its security posture for review.
- When a feature introduces new trust boundaries (external APIs, user input surfaces, auth changes) and I need to enumerate the risks.
- When proposal-critic flagged security concerns in an implementation plan and I need a systematic threat analysis.

### This Skill Is For
- Pre-deployment security reviews grounded in code
- New service or feature threat enumeration using STRIDE
- Teams deciding where to invest in security hardening based on risk priority
- Documenting trust boundaries, assets, and attacker capabilities for audit

### This Skill Is NOT For
- General code review; use `code-reviewer`
- Compliance checklists (SOC2, HIPAA); those are policy frameworks, not threat models
- Penetration testing or vulnerability scanning
- Runtime security monitoring design

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|---|---|---|
| New service about to be deployed | The planner enumerates trust boundaries, assets, and threats from the codebase, then prioritizes mitigations by risk | A threat model document with prioritized mitigations tied to code locations |
| Feature introducing new attack surface | The planner scopes to the changed boundary, enumerates threats specific to the change, and identifies what existing controls cover | A delta threat model focused on the new risk, with gap analysis |
| Security concern flagged in a plan review | The planner converts the concern into a formal threat with likelihood/impact analysis and concrete mitigation options | A risk-grounded response to the review finding |

### When to Escalate
- If the user already has a threat model and needs validation, consider `proposal-critic` for plan review
- If the user needs runtime security monitoring, that is an ops concern outside this skill's scope
- If the user needs penetration testing, that requires tooling and access this planner cannot provide

### Paired With
- `proposal-critic`: review the threat model plan for completeness and feasibility
- Note: `security-reviewer` is an OMC built-in agent for implementation-level security review, not a meta-skill companion
- External verification companions from `trailofbits/skills`: `semgrep`, `codeql`, `sarif-parsing`, `variant-analysis`, `fp-check`, `insecure-defaults`, `sharp-edges`, and `supply-chain-risk-auditor`. Use these as handoffs after threat planning; do not treat this planner as a scanner.

## Purpose

Most threat models fail in one of two ways:
- They are generic checklists disconnected from the actual architecture (every app gets the same OWASP Top 10 rundown).
- They are ad hoc observations without systematic enumeration (important boundaries and assets get missed).

`security-threat-model-planner` exists to prevent both. It anchors every finding to actual code and architecture, uses STRIDE as a systematic enumeration framework, and calibrates severity based on realistic attacker capabilities rather than worst-case assumptions.

## Reference Materials

- `references/security-frameworks.md` — concise summaries of OWASP Top 10, STRIDE, and DREAD with selection guidance
- 2026-06-07 remote audit: Trail of Bits security skills are consumed as verification and triage patterns. Required boundary: no scanner findings without tool output, advisory IDs, lockfile evidence, or code examples; otherwise write a verification handoff.
