---
title: org_skills tool contract
status: specified
---

# org_skills contract

One static tool named `org_skills`, registered with the base tools independently of individual GitHub connections. Its description states: "List available organization skill descriptions or retrieve one complete skill document." No corpus-derived text enters the descriptor.

## Arguments

| Action | Accepted properties | Rules |
|---|---|---|
| `list` | `action`, `pageSize?`, `cursor?` | pageSize integer 1–100, default 20; cursor nonempty opaque string, maximum 2,048 bytes |
| `info` | `action`, `name`, `expectedRevision?` | exact case-sensitive slug; expectedRevision is the opaque revision previously returned, maximum 128 ASCII characters |

`action` is required. Reject unknown properties, including tenant, source, repository, URL, path, ref, credentials and session fields. Reject null/array arguments, numeric coercion, fractional page sizes, empty optional strings and action-specific fields on the wrong action. Reject `enable`, `disable`, `request` and any other action. A syntactically invalid request receives `invalid_arguments` without echoing the supplied value. Source credentials in a malicious argument must not enter logs.

Names match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 100 characters. They are identifiers, never paths. There is no tenant selector. The executor receives only the already authenticated user ID and uses that user's unique current default tenant membership. It ignores request headers/query parameters for catalog scope and does not reuse a general-purpose resolver as its access grant.

## Successful results

`list` returns these fields only:

```json
{
  "skills": [
    {"name": "example-skill", "description": "Example knowledge.", "priority": 10, "scope": "tenant"}
  ],
  "revision": "opaque-source-revision",
  "verifiedAt": "2026-09-14T00:00:00Z",
  "freshness": "fresh",
  "nextCursor": null
}
```

Sort by descending priority and then ASCII ascending name; do not use locale-dependent collation. An approved empty generation has `skills: []`, its actual revision and `nextCursor: null`. A final nonempty page also returns null. No paths, source identities, URLs or internal policy identifiers are returned.

`info` returns these fields only:

```json
{
  "skill": {"name": "example-skill", "description": "Example knowledge.", "priority": 10, "scope": "tenant"},
  "document": "complete original UTF-8 SKILL.md including frontmatter",
  "revision": "opaque-source-revision",
  "verifiedAt": "2026-09-14T00:00:00Z",
  "freshness": "fresh"
}
```

Freshness is `fresh` or `stale`. Successful serialization must preserve the original document after JSON decoding, including line endings; reject invalid UTF-8 before activation. Never truncate, execute, rewrite or append directives. An approved document may contain operator-approved links in its own text; the tool adds no private repository URL or transport credential. Sanitizing a document body belongs to corpus approval, not silent mutation at retrieval.

## Cursors and generation races

Use authenticated encryption from the runtime's maintained cryptographic library with a separate server-held cursor key. The token contains a schema version, tenant binding, authorized source/ref fingerprint, policy epoch, immutable revision and next position; it exposes none of these internal identifiers as plaintext. All instances use the same active cursor key. Never reuse the source or refresh credential as that key.

After authorization, authenticate/decrypt and validate all fields, offset and bounds. A tampered, malformed, wrong-tenant or wrong-source cursor returns `invalid_cursor` without revealing its contents. A cursor for the same authorized source but a superseded revision or policy epoch returns `catalog_changed`. Restart/rotation may invalidate tokens explicitly; never silently restart at page one. With an unchanged epoch and revision, a cursor works on another instance holding that generation. Different instances on different revisions respond catalog-changed rather than mixing pages. Page size may change between calls; the next position remains exact.

Pin one eligible generation for the entire read. Expected revision mismatch returns `catalog_changed` before name lookup. A missing name within an authorized generation returns `not_found`. Scope metadata grants no extra permission. No searching other tenants or old generations is permitted.

## Error transport and audit

The existing MCP transport serializes successful executor return values into `content[0].text`. Catalog failures throw a catalog-specific sanitized error with stable text from this table; the existing wrapper returns `isError: true`. Do not return an error-shaped success object or change unrelated tools' behavior.

| Code | Safe message | Cases |
|---|---|---|
| `invalid_arguments` | `invalid_arguments: Invalid catalog arguments` | invalid action/schema |
| `unavailable` | `unavailable: Catalog unavailable` | no exact/default membership, ambiguous context, disabled/missing policy, policy lookup failure, cold start, expired content, source authorization failure |
| `not_found` | `not_found: Skill not found` | unknown/inaccessible name within an otherwise authorized catalog |
| `invalid_cursor` | `invalid_cursor: Invalid catalog cursor` | malformed/tampered/wrong binding |
| `catalog_changed` | `catalog_changed: Catalog changed; list again` | old generation/epoch, expected revision mismatch |

For an unauthorized catalog, all valid names produce the same unavailable result; never probe to distinguish unknown from inaccessible. Unauthenticated transport requests retain existing authentication errors. Validation, authorization and failure text never reveal supplied values, source URLs, tenant identifiers, exception stacks or upstream response bodies.

The transport records raw `args` on both success and failure by default. An exact `name === 'org_skills'` audit-input sanitizer must be added before either write: record a validated action or `invalid`, safe argument presence flags and outcome only. Do not log raw name, cursor, expected revision, unknown fields or document text. Leave every other tool's audit behavior unchanged. Test this through the HTTP wrapper, not solely in executor unit tests.
