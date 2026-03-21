# MCP Integration Rubric

**Owner:** Security Team
**Review cadence:** Quarterly
**Last updated:** 2026-03-21
**Status:** Active

---

## Purpose

This rubric governs all MCP server integrations connected to the Joyus AI platform. Every MCP integration — whether a first-party server, a community server, or a third-party connector — must pass assessment before being allowed in a tenant environment. The rubric is the single source of truth for integration approval decisions.

---

## Approval Dimensions

Each integration is scored across five dimensions. Each dimension is scored 0–2.

### Dimension 1: Data Access Scope

Does the integration access only the data necessary for its function, and is that scope bounded and auditable?

| Score | Meaning |
|-------|---------|
| 0 — High risk | Broad or unbounded data access; reads/writes beyond what the function requires; no scope declaration |
| 1 — Mitigated | Scope is declared and documented; access exceeds minimum necessary but is bounded and reviewed |
| 2 — Low risk | Minimum necessary access only; scope is declared, enforced at the API level, and auditable |

### Dimension 2: Credential and Auth Model

How does the integration authenticate to external services, and how are credentials managed?

| Score | Meaning |
|-------|---------|
| 0 — High risk | Credentials hardcoded, stored in plaintext, or shared across tenants; no rotation mechanism |
| 1 — Mitigated | Credentials stored in environment variables or a secret manager; rotation is manual but documented |
| 2 — Low risk | Credentials isolated per tenant, stored in a secret manager with automated rotation, never logged |

### Dimension 3: Logging and Auditability

Are all actions taken by the integration logged in a way that supports audit and incident response?

| Score | Meaning |
|-------|---------|
| 0 — High risk | No logging; actions cannot be traced or replayed for audit purposes |
| 1 — Mitigated | Logging exists but is incomplete; some actions or error states are not captured |
| 2 — Low risk | All actions logged with tenant ID, timestamp, tool name, input summary, and outcome; logs are retained per compliance requirements |

### Dimension 4: External Dependency Risk

What is the risk posture of the external service or library the integration depends on?

| Score | Meaning |
|-------|---------|
| 0 — High risk | Dependency is unmaintained, has known unpatched CVEs, or is provided by an unvetted party |
| 1 — Mitigated | Dependency is maintained; CVE history reviewed; supply chain risk acknowledged and tracked |
| 2 — Low risk | Dependency is widely adopted, actively maintained, regularly audited, and pinned to a reviewed version |

### Dimension 5: Sandbox and Execution Constraints

Is the integration constrained from executing arbitrary code, spawning subprocesses, or escaping tenant isolation?

| Score | Meaning |
|-------|---------|
| 0 — High risk | Integration can execute arbitrary code, access the host filesystem, or spawn subprocesses without restriction |
| 1 — Mitigated | Execution is bounded but not fully sandboxed; escape paths exist but are documented and monitored |
| 2 — Low risk | Integration runs in an isolated execution context; no filesystem access beyond declared paths; no subprocess spawning |

---

## Scoring and Approval Thresholds

**Maximum possible score:** 10 (2 per dimension × 5 dimensions)

| Aggregate Score | Decision |
|----------------|---------|
| 0–3 | **Reject** — integration does not meet minimum safety requirements; may reapply after remediation |
| 4–6 | **Pilot** — integration may be used in isolated sandbox tenants only; full approval requires remediation and re-assessment |
| 7–9 | **Pilot with review** — integration may be used in production tenants with enhanced monitoring; re-assessed within 90 days |
| 10 | **Full approval** — integration may be used in any tenant environment without additional restrictions |

### Automatic Block Rule

**Any dimension scored 0 is an automatic block, regardless of the aggregate score.**

A single dimension at 0 represents an unacceptable risk in that category. The integration is blocked and must be remediated before re-assessment. There are no exceptions to this rule.

---

## Integration Lifecycle

Integrations progress through four stages. Each stage has defined entry criteria and exit gates.

### Stage 1: Request

**Entry:** Any team member or contributor proposes adding an MCP integration.

**Required artifacts:**
- Integration name and source repository URL
- Intended use case and list of tools exposed
- Preliminary data access scope declaration
- Auth model description

**Exit gate:** Security Team acknowledges receipt and assigns an assessor within 5 business days.

### Stage 2: Assessment

**Entry:** Assessor begins scoring against the five dimensions.

**Activities:**
- Score each dimension with documented rationale
- Identify any automatic block conditions
- Determine approval tier (reject / pilot / pilot+review / full)
- Produce assessment report

**Exit gate:** Assessment report approved by Security Team lead. Decision communicated to requestor within 10 business days of Stage 1 exit.

### Stage 3: Pilot Allowlist

**Entry:** Integration scores 4+ with no automatic blocks AND integration owner accepts enhanced monitoring conditions.

**Activities:**
- Integration added to pilot allowlist in platform configuration
- Enhanced logging enabled for all integration actions
- Monitoring alert thresholds set
- Re-assessment date scheduled (90 days from pilot start)

**Exit gate:** 90-day pilot completes with no blocking incidents AND re-assessment score is 7+.

### Stage 4: Full Approval or Deprecation

**Entry:** Integration completes Stage 3 successfully (→ Full Approval) OR a blocking incident occurs at any stage (→ Deprecation).

**Full Approval activities:**
- Integration added to approved catalog
- Standard monitoring thresholds applied
- Quarterly audit entry created

**Deprecation activities:**
- Integration removed from all tenant configurations
- Incident documented in audit log
- Affected tenants notified with migration path

---

## Quarterly Audit Checklist

The Security Team runs this checklist every quarter for every integration in the approved catalog.

- [ ] Dependency version reviewed; no unpatched CVEs against pinned version
- [ ] Credential rotation completed or confirmed current
- [ ] Data access scope matches declared scope (spot-check recent logs)
- [ ] Logging completeness verified (sample 10 recent actions; confirm all fields present)
- [ ] Sandbox constraints confirmed active (no new execution paths introduced)
- [ ] Integration owner contact confirmed current
- [ ] Any incidents since last audit reviewed and root causes resolved
- [ ] Score re-calculated; if score drops below 7, open remediation ticket and move to Pilot with Review

---

## Integration Catalog

| Integration | Version | Stage | Score | Approved Date | Next Audit | Owner |
|-------------|---------|-------|-------|---------------|------------|-------|
| *(none yet)* | — | — | — | — | — | — |

---

## Amendment

Changes to this rubric require Security Team approval and a constitution amendment if the change affects G.2 or G.3. Minor clarifications (wording, examples) may be made by the Security Team without a constitution amendment, provided the scoring logic and thresholds are unchanged. All changes are recorded in the changelog below.

### Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-03-21 | Initial version created (WP03, Feature 007) | WP03 |
