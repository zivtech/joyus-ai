---
title: Catalog core data model
status: specified
---

# Data model

No new database tables or migrations. Existing session/skill-enablement rows are neither read nor written. Existing membership records are consulted through a dedicated catalog access adapter.

| Entity | Key / fields | Lifetime and constraints |
|---|---|---|
| Membership grant | existing `(userId, tenantId)`, `isDefault`, role | a present row grants membership; removal revokes; no invented active/revoked column |
| Tenant policy | tenant ID; epoch; enabled; approved; source assignment | authoritative object read each call; no entitlement cache; secret alias only |
| Source identity | provider, owner, repository, approved ref | operator-controlled; excludes credentials from cache identity/log output |
| Validated skill | name, description, priority, scope; internal path/bytes; original document | immutable within generation; exact index/frontmatter agreement |
| Generation | source/ref/revision; verified epoch; verification time; sorted skills and document map | process memory only, bounded by source contract; atomic publication |
| Refresh attempt | opaque operation ID; source; epoch; local sequence; state; started/completed times; category | at most one per source/instance, finite duration and bounded status retention |
| Cursor payload | version; tenant binding; source/ref fingerprint; epoch; revision; offset | authenticated encryption; never authority; all fields revalidated against current access |

Policy identifiers and source identities are internal. Lifecycle state is keyed by tenant binding plus source/ref so two tenants sharing the same repository do not overwrite one another's epoch eligibility. Only immutable revision and verification time appear in successful tool output. The `scope` field describes intended use, not role-based access. There is no persisted "enabled skill," client session, installation record or content-execution entity in this slice.

When current policy differs from the epoch that verified a cached generation, that generation is ineligible until re-verification. Old generation objects may remain briefly for already-authorized bounded reads; their existence never grants a new call access. A failed candidate does not mutate a valid generation. A source authorization failure can separately mark that instance's source unreadable without editing document bytes.
