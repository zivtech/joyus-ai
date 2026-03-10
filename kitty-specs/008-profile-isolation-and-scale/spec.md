# Feature Specification: Profile Isolation and Scale

**Feature Branch**: `008-profile-isolation-and-scale`
**Created**: 2026-03-10
**Status**: Draft
**Phase**: 3 (Platform Framework)
**Dependencies**: 005 (Content Intelligence), 003 (Platform Architecture), 006 (Content Infrastructure), 007 (Org-Scale Agentic Governance)
**Constitution**: §2.2 (Skills as Encoded Knowledge), §2.10 (Client Abstraction), §2.4 (Monitor Everything), §2.1 (Multi-Tenant from Day One)

## Purpose

The Profile Engine (Spec 005) ships a 129-feature stylometric engine that builds structured writing profiles from corpora. It works. The problem is that it was built for a single-tenant proof of concept — one organization, one corpus, one set of profiles. Phase 3 demands multi-tenant operation where arbitrary clients onboard their own corpora and generate profiles without cross-contamination, without manual intervention, and without degrading fidelity for existing tenants.

This spec defines how profiles are isolated between tenants, how profile lifecycles are managed at scale (creation, versioning, retraining, archival), and how the self-service onboarding pipeline generalizes the methodology to arbitrary domains.

## Scope

### In Scope

- Tenant-scoped profile generation with data isolation at the data layer (not just API layer)
- Profile versioning with immutable version identifiers and rollback support
- Composite profile inheritance (org, department, individual tiers)
- Self-service corpus intake supporting PDF, DOCX, TXT, HTML, Markdown
- Content-hash corpus deduplication within tenant scope
- Resolved profile caching with inheritance-aware invalidation
- Concurrent pipeline execution for multiple tenants
- Profile version retention and archival lifecycle

### Out of Scope

- Changes to the stylometric engine itself (Spec 005 is stable)
- Hard tenant isolation via separate schemas/databases (soft isolation via tenant_id scoping per ADR-0002 Leash pattern)
- Real-time streaming profile updates (batch pipeline only)
- Cross-tenant profile sharing or marketplace
- Profile export/import between platform instances

## User Scenarios & Testing

### User Story 1 - Tenant-Scoped Profile Generation (Priority: P1)

A new client uploads a corpus of 40 documents across 3 authors. The platform ingests the corpus, runs the stylometric pipeline, and produces isolated profiles scoped to that tenant. No other tenant's profiles or corpus data are visible or accessible during any step.

**Why this priority:** Without tenant isolation, the platform cannot onboard a second client. This is the foundational gate for multi-tenancy.

**Independent Test:** Onboard two tenants with overlapping author names. Verify that Tenant A's "Jane Smith" profile contains zero features derived from Tenant B's corpus.

**Acceptance Scenarios:**

- **Given** a new tenant with a valid corpus of >=10 documents, **when** the profile generation pipeline runs, **then** all generated profiles are scoped exclusively to that tenant's namespace and are inaccessible via any other tenant's API credentials.

- **Given** two tenants with authors sharing the same display name, **when** either tenant queries their profiles, **then** results contain only their own tenant's profile data with no leakage from the other tenant.

- **Given** a tenant's corpus ingestion fails midway (e.g., 22 of 40 documents processed), **when** the pipeline resumes or retries, **then** no partial profiles are visible to the tenant until the full pipeline completes successfully, and no partial data is accessible to other tenants.

- **Given** a tenant's profile generation is in progress, **when** another tenant initiates their own profile generation concurrently, **then** both pipelines complete independently with correct results and neither blocks the other.

### User Story 2 - Profile Versioning and Rollback (Priority: P1)

A client adds 15 new documents to an existing corpus and triggers profile regeneration. The platform produces a new version of affected profiles while retaining the previous version. If the new version degrades fidelity (detected via attribution scoring), the client can roll back to the prior version.

**Why this priority:** Without versioning, any corpus change is a one-way door. Clients will not trust a system that cannot undo a bad profile update.

**Independent Test:** Generate profiles from corpus v1 (30 docs). Add 10 documents, regenerate as v2. Verify v1 is still queryable and restorable.

**Acceptance Scenarios:**

- **Given** an existing profile at version N, **when** the corpus is updated and profiles are regenerated, **then** the new profiles are stored as version N+1 and version N remains queryable via explicit version reference.

- **Given** a profile at version N+1 with a fidelity score below the tenant's configured threshold, **when** a rollback is requested, **then** version N becomes the active profile and all downstream consumers (generation, attribution) use version N until a new version is explicitly promoted.

- **Given** a profile with 5 historical versions, **when** the tenant queries version history, **then** all versions are listed with creation timestamp, corpus snapshot reference, and fidelity score at time of generation.

### User Story 3 - Composite Profile Inheritance (Priority: P2)

An organization defines an org-level voice profile (brand voice). Individual author profiles inherit from the org profile but override specific features (sentence cadence, vocabulary preferences). Department-level profiles sit between org and individual.

**Why this priority:** Real organizations have brand voice requirements that coexist with individual author styles. This is the second-order use case after basic isolation works.

**Independent Test:** Create an org profile, a department profile that overrides 3 features, and an individual profile that overrides 2 more. Verify the resolved profile at each level reflects the correct inheritance chain.

**Acceptance Scenarios:**

- **Given** an org-level profile and an individual author profile, **when** the resolved profile is computed for that author, **then** org-level features are present except where the individual profile explicitly overrides them, and the override source is traceable.

- **Given** a three-tier hierarchy (org > department > individual), **when** the department profile overrides an org feature and the individual profile does not re-override it, **then** the resolved individual profile reflects the department's override, not the org's original value.

- **Given** an org-level profile update, **when** the org profile is republished, **then** all downstream department and individual resolved profiles reflect the change unless they have explicit overrides for the affected features.

### User Story 4 - Self-Service Corpus Intake (Priority: P2)

A client uploads documents through the platform's intake interface (API or UI). The system validates document formats, deduplicates against existing corpus entries, extracts author attribution metadata, and queues the corpus for profile generation — all without operator intervention.

**Why this priority:** Manual corpus intake does not scale. Self-service is required before the third client onboards.

**Independent Test:** Upload a mixed-format corpus (PDF, DOCX, plain text) with 2 duplicate documents. Verify deduplication, format normalization, and author extraction complete without manual steps.

**Acceptance Scenarios:**

- **Given** a corpus upload containing supported formats (PDF, DOCX, TXT, HTML, Markdown), **when** the intake pipeline processes the upload, **then** all documents are normalized to the platform's internal representation and author metadata is extracted or prompted for.

- **Given** a corpus upload containing 3 documents already present in the tenant's corpus (by content hash), **when** the intake pipeline runs, **then** duplicates are flagged, the tenant is notified, and duplicates are excluded from profile regeneration unless the tenant explicitly re-includes them.

- **Given** a corpus upload containing an unsupported format, **when** the intake pipeline encounters it, **then** the unsupported file is rejected with a clear error, and all supported files in the same upload continue processing.

### User Story 5 - Profile Caching and Precomputation (Priority: P3)

For tenants with large corpora (500+ documents, 20+ authors), resolved profiles are precomputed and cached. Cache invalidation triggers on corpus changes, org profile updates, or manual refresh.

**Why this priority:** Latency optimization for large tenants. Not blocking for launch but required before enterprise-scale onboarding.

**Independent Test:** Generate profiles for a 500-document corpus. Verify that subsequent profile lookups return cached results in <50ms. Update the corpus and verify cache invalidation and regeneration.

**Acceptance Scenarios:**

- **Given** a precomputed resolved profile in cache, **when** the profile is requested, **then** the cached version is returned without re-running the inheritance resolution or stylometric computation.

- **Given** a cached resolved profile, **when** any profile in its inheritance chain is updated, **then** the cache entry is invalidated and the next request triggers recomputation.

### Edge Cases

- **Tenant deletion:** All profiles, corpus data, and version history for the tenant are soft-deleted (recoverable for 30 days) then hard-deleted. No orphaned data remains in shared indexes.
- **Zero-document corpus:** Profile generation is rejected with a clear error; no empty profiles are created.
- **Single-author corpus:** The system generates a profile but flags it as low-confidence (no contrastive signal for stylometric differentiation).
- **Corpus with no attributable authors:** Documents are ingested but profile generation is deferred until author attribution is provided or inferred.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | All profile data (raw corpus, stylometric features, markers, resolved profiles) MUST be scoped to a single tenant. Cross-tenant data access MUST be denied at the data layer, not just the API layer. | P1 |
| FR-002 | Profile generation pipelines MUST execute within a tenant-scoped context that prevents reads or writes to other tenants' data, even in the event of application-level bugs. | P1 |
| FR-003 | Every profile MUST have an immutable version identifier. Profile updates MUST create new versions, never mutate existing versions. | P1 |
| FR-004 | The platform MUST support rollback to any previous profile version within the retention window. Rollback MUST be atomic (all consumers switch simultaneously). | P1 |
| FR-005 | Profile inheritance MUST support at least three tiers (org > department > individual). The resolved profile at any tier MUST be deterministically computable from the inheritance chain. | P2 |
| FR-006 | Self-service corpus intake MUST support PDF, DOCX, TXT, HTML, and Markdown formats. Unsupported formats MUST be rejected without blocking the rest of the upload. | P2 |
| FR-007 | Corpus deduplication MUST use content-hash comparison. Duplicate detection MUST operate within tenant scope only. | P2 |
| FR-008 | Resolved profile caching MUST invalidate on any upstream change in the inheritance chain. Stale cache entries MUST NOT be served after invalidation. | P3 |
| FR-009 | Profile version history MUST be retained for at least 90 days or the tenant's configured retention period, whichever is longer. | P1 |
| FR-010 | Concurrent profile generation pipelines for different tenants MUST NOT contend on shared resources in a way that causes correctness failures. Performance degradation under contention is acceptable; data corruption is not. | P1 |

### Non-Functional Requirements

- NFR-001: Profile generation for a 50-document corpus MUST complete within 10 minutes wall clock time.
- NFR-002: Profile rollback MUST complete (all consumers switched) within 30 seconds.
- NFR-003: Cached resolved profile lookups MUST return in under 50ms at p95.
- NFR-004: Self-service corpus intake MUST process a 100-document mixed-format upload with no more than 2 manual interventions.
- NFR-005: Profile fidelity after inheritance resolution MUST degrade by no more than 5% compared to a standalone profile built from the same corpus.

### Key Entities

**TenantProfile**
- `tenant_id`: Scoping key (foreign key to tenant)
- `profile_id`: Unique within tenant
- `version`: Monotonically increasing integer
- `author_id`: Reference to attributed author (nullable for org/dept profiles)
- `tier`: `org | department | individual`
- `parent_profile_id`: Reference to parent in inheritance chain (nullable for org-level)
- `corpus_snapshot_id`: Reference to the corpus version used for generation
- `stylometric_features`: 129-feature vector (Spec 005 schema)
- `markers`: Marker set (Spec 005 markers.json schema)
- `fidelity_score`: Attribution accuracy at time of generation
- `status`: `generating | active | rolled_back | archived`
- `created_at`, `archived_at`

**CorpusSnapshot**
- `snapshot_id`: Unique identifier
- `tenant_id`: Scoping key
- `document_hashes`: Set of content hashes included in this snapshot
- `document_count`: Total documents
- `author_count`: Distinct authors detected
- `created_at`

## Success Criteria

| ID | Criterion | Target |
|---|---|---|
| SC-001 | Profile generation for a 50-document corpus completes within time limit | <= 10 min |
| SC-002 | Cross-tenant data access attempts are denied with zero false negatives over 10,000 test queries | 0 leaks |
| SC-003 | Profile rollback completes (all consumers switched) within time limit | <= 30s |
| SC-004 | Resolved profile cache hit returns within latency target at p95 | <= 50ms p95 |
| SC-005 | Self-service corpus intake processes a 100-document mixed-format upload with minimal manual intervention | <= 2 manual steps |
| SC-006 | Profile fidelity after inheritance resolution degrades by no more than threshold vs standalone | <= 5% degradation |

## Assumptions

- Spec 005's stylometric engine is stable and does not require architectural changes to support multi-tenant execution — only scoping and lifecycle management.
- Tenant isolation at the data layer (FR-001) will be enforced by the platform's multi-tenancy infrastructure (ADR-0002, Leash pattern), not reimplemented per-feature.
- Corpus sizes for the initial cohort of clients are <=500 documents and <=30 authors. Scaling beyond this is a future optimization, not a launch blocker.
- The entitlement model from Spec 006 governs which tenants have access to profile features (generation, versioning, composite inheritance) based on their product tier.

## References

- Spec 005: Content Intelligence (Profile Engine) — stylometric features, markers, fidelity tiers
- Spec 006: Content Infrastructure — entitlement model, content state management
- Spec 007: Org-Scale Agentic Governance — governance gates for profile quality
- Spec 009: Automated Pipelines Framework — event-driven triggers for profile regeneration
- ADR-0002: Leash Multi-Tenancy — tenant isolation architecture (soft isolation, application-scoped tenant_id filtering)
- ADR-0003: Agate Pattern — component discovery for profile services
- Constitution §2.1, §2.2, §2.4, §2.10
