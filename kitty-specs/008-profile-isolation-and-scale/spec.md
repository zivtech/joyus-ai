# Specification: Profile Isolation and Scale

**Project:** Joyus AI Platform
**Phase:** 2.5+ — Profile Platform Layer
**Date:** March 14, 2026
**Status:** Specification Complete

---

## 1. Overview

### Problem

The joyus-profile-engine (Python, 129-feature stylometrics, 97.9% accuracy) operates as a standalone library with no concept of multi-tenancy, versioning, or access control. The platform currently references profiles by opaque string IDs (`profileId` in content schema tables, mediation sessions, generation logs, drift reports) but has no authoritative profile registry, no tenant isolation enforcement at the profile layer, no version history, and no mechanism to handle profile staleness or retraining at scale.

As the platform onboards multiple tenants, three critical gaps emerge:
1. **Isolation**: Tenant A's profiles must never be visible to Tenant B. Today, `profileId` is a free-text field with no ownership enforcement.
2. **Scale**: Batch ingestion of large document corpora, profile caching, and latency optimization are missing. Each profile computation is expensive (129-feature extraction).
3. **Lifecycle**: Profiles evolve as authors evolve. There is no versioning, staleness detection, or drift-triggered retraining.

### Solution

Build the platform layer that wraps the Python profile engine with multi-tenant isolation, semantic versioning, caching, batch ingestion, and drift-triggered retraining. This layer lives in `joyus-ai` (TypeScript/Express/Drizzle) and communicates with the Python profile engine via a service interface. It does not rewrite the engine — it governs access to it.

### Users

- **Tenant administrators** — manage profiles for their organization's authors
- **Content generation pipeline** — consumes profile versions for voice-matched generation (Spec 006)
- **Fidelity monitoring system** — triggers retraining when drift exceeds thresholds (Spec 005)
- **Pipeline automation** — runs profile generation and fidelity checks as pipeline steps (Spec 009)
- **Platform operators** — monitor profile health across tenants

---

## 2. Functional Requirements

### FR-001: Tenant-Scoped Profile Registry

A centralized registry of writing profiles, each owned by exactly one tenant. Every profile record includes `tenantId`, `authorName`, `authorType` (person/organization), and metadata. Profiles are queried only within tenant scope — all queries filter by `tenantId` at the database level.

### FR-002: Profile Access Control

Implement `assertProfileAccessOrAudit()` guard that validates the requesting user has access to the profile's tenant before any read, write, or use operation. On access denial, emit a structured audit event (`ProfileAccessDeniedError`) and return 403. On success, log the access for audit trail.

### FR-003: Profile Access Audit Log

Every profile access (read, create, update, use-in-generation, version-pin) is logged to an immutable audit table with `tenantId`, `userId`, `profileId`, `action`, `result` (allowed/denied), and `timestamp`. Audit logs are tenant-scoped and queryable for compliance.

### FR-004: Session-Profile Binding Validation

When a mediation session (`contentMediationSessions.activeProfileId`) references a profile, validate that the session's `tenantId` matches the profile's `tenantId`. Reject session creation or profile binding if tenants do not match.

### FR-005: Profile Versioning

Each profile supports semantic versions (1.0, 1.1, 2.0). Creating or retraining a profile creates a new version. Previous versions are retained and queryable. The `currentVersion` pointer tracks the latest version. A version record stores the feature vector snapshot, training corpus metadata, accuracy score, and creation timestamp.

### FR-006: Profile Version Pinning

Content generation and pipeline steps can pin to a specific profile version (e.g., "use profile X at version 1.2"). This prevents unexpected behavior when a profile is retrained mid-pipeline. If no version is specified, the current version is used.

### FR-007: Profile Diff Engine

Compare two versions of the same profile to produce a structured diff: which stylometric features changed, by how much, and in which direction. This supports human review of profile evolution and debugging of drift.

### FR-008: Staleness Detection

Profiles that have not been refreshed within a configurable window (default: 30 days) are flagged as stale. Staleness is computed on query (not via background job) by comparing `lastRetrainedAt` against `stalenessThresholdDays`. Stale profiles are still usable but carry a `isStale: true` flag in API responses.

### FR-009: Drift-Triggered Retraining

When Spec 005's drift monitoring detects that a profile's overall drift score exceeds a configurable threshold (default: 0.7), emit a `profile.drift.exceeded` event. The profile module listens for this event and enqueues a retraining job. If Spec 009's pipeline framework is available, the retraining runs as a pipeline step; otherwise, it runs as a standalone background job.

### FR-010: Batch Ingestion Pipeline

Process large document corpora (100+ documents) for profile creation or retraining. The batch pipeline:
- Accepts a list of document references (content item IDs from Spec 006)
- Queues documents for feature extraction
- Tracks progress (documents processed / total)
- Emits completion event with accuracy metrics
- Supports cancellation

### FR-011: Profile Caching

Cache computed profile feature vectors in memory (LRU) with configurable TTL (default: 1 hour). Cache key is `tenantId:profileId:version`. Cache is invalidated on profile retraining or version change. Reduces latency for repeated profile lookups during generation and verification.

### FR-012: Profile Engine Service Interface

Define a TypeScript interface (`ProfileEngineClient`) that abstracts communication with the Python profile engine. The interface supports:
- `extractFeatures(documents: string[]): Promise<FeatureVector>`
- `computeSimilarity(vectorA: FeatureVector, vectorB: FeatureVector): Promise<number>`
- `trainProfile(documents: string[]): Promise<TrainedProfile>`

Ship a `NullProfileEngineClient` stub for environments where the Python engine is unavailable.

### FR-013: Profile API Routes

Express routes for profile management, all tenant-scoped:
- `POST /api/profiles` — create profile (triggers initial training)
- `GET /api/profiles` — list profiles for tenant
- `GET /api/profiles/:id` — get profile with current version
- `GET /api/profiles/:id/versions` — list version history
- `GET /api/profiles/:id/versions/:version` — get specific version
- `GET /api/profiles/:id/diff/:versionA/:versionB` — compare versions
- `POST /api/profiles/:id/retrain` — trigger retraining
- `POST /api/profiles/:id/pin` — pin a version for generation
- `DELETE /api/profiles/:id` — soft-delete (archive) profile
- `GET /api/profiles/:id/audit` — query audit log

### FR-014: Profile MCP Tools

MCP tool definitions for profile operations:
- `profile_list` — list profiles for tenant
- `profile_get` — get profile details and current version
- `profile_create` — create new profile
- `profile_retrain` — trigger retraining
- `profile_versions` — list version history
- `profile_diff` — compare two versions
- `profile_status` — staleness, drift score, last retrained

---

## 3. Non-Functional Requirements

### Performance
- Profile lookup (cache hit): < 5ms p95
- Profile lookup (cache miss, DB fetch): < 50ms p95
- Batch ingestion throughput: >= 10 documents/second
- Profile feature extraction (single document): < 2 seconds via engine client
- Version diff computation: < 100ms for any two versions

### Security
- All profile data is tenant-scoped. No cross-tenant query path exists.
- Profile access audit log is append-only (no UPDATE or DELETE on audit table)
- Profile feature vectors are stored encrypted at rest (PostgreSQL column-level or disk encryption)
- `assertProfileAccessOrAudit()` is the single enforcement point — all code paths go through it

### Availability
- Profile cache degrades gracefully: cache miss falls through to DB, not error
- Batch ingestion survives server restart: jobs are queue-backed with at-least-once delivery
- Retraining failures do not corrupt the current profile version (new version is created only on success)

### Cost
- Profile cache: < 50MB memory per 1000 cached profiles (feature vectors are ~2KB each)
- Audit log retention: 90 days default, configurable per tenant
- Batch jobs: no additional infrastructure — runs in the existing Express process with queue table

---

## 4. User Scenarios

### Scenario 1: Onboarding a New Client's Writing Profiles

A tenant administrator uploads 50 writing samples for their CEO. The platform creates a new profile, runs batch ingestion to extract stylometric features, trains the initial profile (version 1.0), and reports accuracy metrics. The profile is immediately available for content generation.

### Scenario 2: Cross-Tenant Access Prevention

A user at Tenant A attempts to reference a profile ID belonging to Tenant B in a generation request. The `assertProfileAccessOrAudit()` guard detects the tenant mismatch, logs a `ProfileAccessDeniedError` audit event, and returns 403. The generation request fails safely.

### Scenario 3: Drift-Triggered Retraining

The drift monitor (Spec 005) detects that the CEO profile's drift score has risen to 0.82 (above the 0.7 threshold). It emits a `profile.drift.exceeded` event. The profile module enqueues a retraining job. The job fetches the latest writing samples from the content corpus, trains a new version (1.1), and updates the `currentVersion` pointer. The old version (1.0) is retained for rollback.

### Scenario 4: Version Pinning in Pipeline

A content pipeline (Spec 009) generates a weekly newsletter using the CEO's voice. The pipeline definition pins to profile version 1.0. When version 1.1 is created mid-week from drift-triggered retraining, the pipeline continues using 1.0 until an administrator explicitly updates the pin. This prevents unexpected voice changes in in-flight content.

### Scenario 5: Investigating Profile Evolution

A tenant administrator notices the CEO's generated content feels different. They use `profile_diff` to compare version 1.0 and 1.1, seeing that formality increased by 15% and sentence complexity decreased by 10%. This confirms the CEO's recent writing style has shifted toward more concise communication, and the retraining correctly captured it.

---

## 5. Key Entities

| Entity | Description |
|--------|-------------|
| Profile | A writing profile owned by one tenant, representing one author's voice |
| ProfileVersion | A point-in-time snapshot of a profile's feature vector and training metadata |
| FeatureVector | The 129-dimensional stylometric representation produced by the profile engine |
| ProfileAuditEntry | Immutable record of a profile access or modification event |
| BatchIngestionJob | A queued job to process multiple documents for profile training |
| ProfileCache | In-memory LRU cache of feature vectors keyed by tenant:profile:version |
| ProfileEngineClient | TypeScript interface abstracting the Python profile engine |
| DriftRetrainingEvent | Event emitted when drift exceeds threshold, triggering retraining |

---

## 6. Success Criteria

1. **Tenant isolation verified** — integration test confirms cross-tenant profile access returns 403 and logs audit event
2. **Versioning complete** — profiles support create, retrain (new version), pin, diff, and rollback
3. **Batch ingestion functional** — 100-document corpus processes within 20 seconds with progress tracking
4. **Cache effective** — repeated profile lookups show < 5ms p95 on cache hit
5. **Drift retraining works** — drift score above threshold triggers automatic retraining and creates new version
6. **Audit trail complete** — all profile operations are logged and queryable per tenant
7. **API and MCP tools operational** — all 10 routes and 7 MCP tools respond correctly
8. **Zero cross-tenant data leaks** — no query path returns profiles from another tenant

---

## 7. Assumptions

- The Python profile engine (`joyus-profile-engine`) is available as a callable service or subprocess. The platform wraps it; it does not embed it.
- The `content` schema (Spec 006) is deployed — profile IDs in `contentProductProfiles`, `contentGenerationLogs`, and `contentDriftReports` reference profiles from this module.
- PostgreSQL supports the query patterns needed (JSONB for feature vectors, partial indexes for staleness).
- The event bus pattern (if Spec 009 is deployed) is available for drift-triggered retraining. If not, a polling fallback is used.
- Feature vectors are approximately 2KB per profile version (129 features as float64 + metadata).

---

## 8. Dependencies

- **Spec 005** (Content Intelligence): Drift monitoring emits signals consumed by FR-009. Voice analyzer interface already exists.
- **Spec 006** (Content Infrastructure): Content schema already references `profileId`. Content items provide the training corpus.
- **Spec 007** (Governance): Profile operations emit governance-compatible audit events. Access control follows the platform's auth middleware pattern.
- **Spec 009** (Automated Pipelines): Profile generation and fidelity check are pipeline step types. Retraining can run as a pipeline step. Soft dependency — works without Spec 009.
- **External**: Python profile engine library (`joyus-profile-engine`). Communication mechanism TBD (subprocess, HTTP, or direct FFI).

---

## 9. Edge Cases

- **Profile with zero versions**: A profile created but not yet trained has no versions. API returns `currentVersion: null` and `status: 'pending_training'`.
- **Concurrent retraining**: Two drift events trigger two retraining jobs for the same profile simultaneously. Use database-level advisory locks on `profileId` to serialize retraining. Second job skips if a newer version already exists.
- **Stale profile used in generation**: Stale profiles are still usable. The `isStale` flag is informational. Governance (Spec 007) can enforce policies on stale profile usage.
- **Version pinned to deleted version**: If a pinned version's profile is archived, return the pinned version data with a warning flag. Do not silently fall back to a different profile.
- **Batch ingestion with invalid documents**: Skip documents that fail feature extraction, log errors, continue processing remaining documents. Report partial success with error count.
- **Cache stampede on popular profiles**: Use a mutex/lock pattern on cache miss to prevent multiple concurrent DB fetches for the same profile version.
- **Audit log volume**: High-traffic tenants may generate thousands of audit entries per day. Use time-based partitioning or archival after retention window.

---

## 10. Out of Scope

- **Rewriting the Python profile engine** — this spec wraps it, does not replace it
- **Real-time profile training** — training is batch-oriented, not streaming
- **Cross-tenant profile sharing** — profiles are strictly tenant-isolated (future: explicit sharing with consent)
- **Profile marketplace** — no discovery or exchange of profiles between tenants
- **UI/dashboard for profile management** — API and MCP tools only; UI is a future feature
- **Profile engine deployment** — how the Python engine is deployed/hosted is outside this spec
- **Encryption key management** — uses the platform's existing encryption infrastructure
