---
title: Catalog source and generation contract
status: specified
---

# Source and generation contract

## Approved source

The first adapter reads an operator-approved GitHub repository and ref with a server-held read-only credential. The policy is the sole source of repository identity and approved ref; user tool inputs cannot select them. The secret value is resolved from a configured environment secret alias, never stored in a catalog or policy document. Ordinary catalog members cannot refresh or manage a source merely by being members.

Resolve the ref once to a commit, inspect the corresponding Git tree and fetch index/documents at that immutable revision. Check each path component for ordinary tree/blob types; reject symlinks, submodules, missing paths and truncated/incomplete tree responses. Follow ordinary directories with bounded traversal if the recursive tree is incomplete, or reject the candidate explicitly. Never accept a symlink just because its resolved body looks valid. No archive extraction or local installation is needed.

Use the approved GitHub API origin with HTTPS, fixed adapter paths and encoded identifiers. Disable automatic redirects; any redirect is a source failure, with no forwarding of Authorization. Do not trust source-provided download URLs. Timeouts, retry work, downloaded bytes and tree traversal all count against the candidate budget. Git object IDs are identity, not an ordering clock.

## Index schema 1

The root is a JSON object with exactly `schemaVersion: 1`, a parseable RFC3339 `generatedAt` string, and a `skills` array. Each entry has exactly:

| Field | Validation |
|---|---|
| name | canonical slug, maximum 100 characters; unique across catalog |
| description | string with at least one non-whitespace character |
| priority | integer 0–100; no numeric coercion |
| scope | `tenant`, `role` or `task` |
| path | exact literal `skills/<name>/SKILL.md` |
| bytes | nonnegative safe integer, equals original UTF-8 byte count |

`generatedAt` is descriptive and may not be used as proof of content integrity, verification time or temporal ordering. Index order is ignored; serving order is specified in the tool contract. Require JSON syntax with the runtime JSON parser, then use the maintained YAML parser's strict JSON-compatible document parsing and unique-key checks to reject duplicate JSON member keys before accepting the object. Both parse stages must succeed. Normal JSON parsing alone silently accepts duplicates and is insufficient; do not hand-roll a parser. Verify duplicate-key behavior with nested fixtures when locking the dependency version.

## Documents

Each original document must be valid UTF-8 and have one opening and closing frontmatter delimiter on separate lines. Both LF and CRLF are supported without normalization. The frontmatter is a mapping with exactly `name`, `description`, `priority`, `scope`, matching the index by parsed scalar values and types. Require nonempty body text. Reject duplicate fields, aliases, anchors, custom tags, merge keys, extra documents, unexpected fields, malformed delimiters and parser errors/warnings. Reject a leading byte-order mark rather than stripping it. The original bytes, not a reserialized YAML representation, are retained.

Use the maintained `yaml` parser in strict mode with unique keys and alias expansion disabled; inspect the syntax tree to reject anchors/tags/merge keys. Do not hand-roll a custom parser for this. Structural validation does not certify the truth, safety or model effectiveness of a skill body; source approval remains necessary.

## Bounds

| Resource | Maximum / default |
|---|---|
| Entries | 1,000 |
| Index original bytes | 1 MiB |
| Document original bytes | 256 KiB each |
| All original documents | 16 MiB per generation |
| Whole candidate elapsed time | 120 seconds, including retries/traversal |
| Source downloads | at most 4 in flight per candidate |
| Candidate refreshes | one per source per instance; at most 2 sources concurrently per instance |

Enforce limits during streaming, including decoded representation where source transport wraps bytes. Do not trust Content-Length alone. Bound index/tree response parsing as well as blob bodies; reject a tree response beyond 1 MiB and use bounded nonrecursive traversal or fail clearly. Abort all remaining fetches on rejection or timeout. Check aggregate indexed bytes before downloads and actual bytes afterward. Zero entries is valid; zero-byte/missing-body documents are not.

An activated generation is immutable and includes source/ref identity, policy epoch, revision, sorted metadata, original documents and successful verification time. Its cache identity includes source, approved ref and revision; an epoch change requires re-verification before reuse. For lifecycle and quota purposes, a logical source key also includes the tenant policy binding. Two tenants assigned the same repository/ref retain independent epoch eligibility and source-authorization state; refreshing one must not invalidate the other's policy binding. Deduplicating immutable document bytes is optional and may never deduplicate grants.

Keep only one active and one bounded candidate per logical source. Admit at most 32 MiB of active original documents across tenants, reserving the remainder of the 64 MiB total for candidates and temporarily retained old generations. Enforce the total across active/candidate/read-held retired documents during allocation, not only at activation. A replacement counts against active admission by its resulting active size; new admission or growth beyond 32 MiB returns a sanitized capacity rejection. A replacement refresh must still be possible at the active cap. If old request-held data temporarily consumes candidate headroom, reject/defer that attempt until the read releases it within five seconds; never exceed the total to force progress.

Do not evict another tenant's currently approved active generation to admit a new tenant. A newly configured tenant beyond capacity remains unavailable with an operator-visible `limit` refresh category. Recovery is explicit: the operator disables/removes an unused mapping or reduces an approved corpus, or a separately scoped capacity change provides more headroom. On the next successful policy sweep (at most five-minute timer cadence while dependencies are healthy), remove disabled/unapproved/removed or source/ref-replaced generations from active storage and release their bytes once existing bounded reads finish; periodic refresh retries the waiting source fairly. Policy-read failure cannot be treated as approval to serve or as a successful cleanup sweep. Policy read authorization still revokes immediately and does not wait for this memory cleanup.

Schedule configured logical sources in round-robin order, coalescing to at most one queued request per configured source (maximum 1,000), with at most two active attempts. Timer/manual triggers do not jump ahead of already queued sources. An attempt's 120-second candidate budget begins when a worker slot starts it; queued status reports accepted/in-progress without claiming source verification. A full queue rejects new manual work with 429; source capacity failures leave retry to the next timer/manual trigger. No five-minute activation guarantee is asserted under queue pressure or outages. These are byte/work limits, not a claim about total process RSS or support for 1,000 simultaneously populated tenant catalogs.
