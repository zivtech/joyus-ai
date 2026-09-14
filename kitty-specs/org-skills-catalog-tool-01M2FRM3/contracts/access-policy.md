---
title: Catalog access policy contract (generic)
status: specified
---

# Access policy

This is a generic design and behavior contract for the `CatalogAccessPolicyReader` port, not an assertion that any specific authority is provisioned. Generic tests use injected policy readers and two instances sharing one simulated authority. Actual deployment coordinates, credentials, IAM roles and operational runbooks are outside this package.

## Policy object schema (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "tenants": {
    "example-tenant-id": {
      "epoch": "00000000-0000-4000-8000-000000000000",
      "enabled": true,
      "approved": true,
      "source": {
        "provider": "github",
        "owner": "example-org",
        "repository": "example-skills-corpus",
        "ref": "main",
        "credentialAlias": "example-source-credential-alias"
      }
    }
  }
}
```

Each tenant entry has exactly `epoch` (a new UUID on every policy change), `enabled` (boolean), `approved` (boolean), and `source` with `provider: github`, `owner`, `repository`, `ref`, and `credentialAlias`. Epochs are equality tokens, not sortable counters. Validate the complete object, reject duplicates/unknown fields, and bound it to 1 MiB and 1,000 tenant entries. Reject missing/malformed policy as unavailable — never as "no policy = allow." Names and identifiers in this contract and in any committed test fixture are synthetic; real repository/tenant identities never appear in generic fixtures.

## Read order (per tool call)

1. Validate argument shape without echoing untrusted values.
2. Query the primary membership store for exactly one default membership for the authenticated user. Require the exact `(userId, tenantId)` row in the same query/snapshot; zero or multiple rows denies access. No role override, API-key-only grant, self-scope fallback or environment allowlist is permitted. Bound lookup to two rows to detect ambiguity. Use a fresh primary read, not a replica or retained transaction snapshot.
3. Read and validate current policy with a two-second overall deadline, no SDK retries extending that deadline. Missing/unreadable/disabled/unapproved mapping denies access. Check source host/ref and credential alias against server adapter restrictions.
4. Select a coherent generation verified under that tenant entry's current epoch. If none exists, schedule/coalesce refresh and return unavailable. Re-enable, source replacement and credential rotation require a new epoch and successful source verification before cached content becomes eligible again.
5. Validate cursor/expected revision and return from one pinned generation. Never store or reuse the membership/policy decision across calls. Bound the entire read to a five-second deadline and fail closed on dependency errors.

The control's linearization boundary is the fresh membership/policy read. A tool call initiated after a successful membership deletion commit or policy-object replacement acknowledgement must observe the revocation or fail closed. Already-authorized in-flight calls may finish within their bounded deadline; this does not retract documents already delivered to a client.

## Policy change semantics (generic)

A disable is `enabled: false`, an approval withdrawal is `approved: false`, and a removal deletes the entry. Any change generates a fresh epoch for that entry; re-enabling also creates a fresh epoch — never restore a historical epoch. Rolling back content selects an earlier approved ref/revision under another new epoch. No client-facing management endpoint or credential-mutation capability is part of this tool's surface.

## Reference adapter behavior

The production S3 adapter performs one uncached, authenticated GetObject per call against the configured primary bucket in its configured region, with no CDN, replica, cache, version-pinned read or last-known-good fallback. The object's location and region are server deployment settings, never caller inputs, and are configured by name only — for example `CATALOG_POLICY_REGION`, `CATALOG_POLICY_BUCKET`, `CATALOG_POLICY_KEY` — with no actual values, coordinates or credentials in this package. A distinct write path may be used to replace the object; this contract does not specify or require any particular write/provisioning procedure.

## Failure behavior

Missing authority keeps only this feature unavailable; it must not prevent other tools from starting. Policy-read failure never authorizes serving from cache — a malformed shared object affects every tenant relying on it, so the adapter must validate the complete object before use and fail closed on any structural problem. Per-tenant policy objects or a database-backed policy store may replace this adapter in a separately reviewed change if they satisfy the same read-order and failure-behavior contract above.
