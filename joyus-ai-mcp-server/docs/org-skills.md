# Organization skills catalog

## Selected-workspace protected MCP retrieval (schema 2)

The static `org_skills` descriptor supports strict `list` and `info` arguments with
`schemaVersion: 2` and an explicit `workspaceId`. Actor identity comes from MCP bearer
authentication. The selected workspace's fresh tool decision and v2 skill allow-set
must both authorize retrieval; the legacy default workspace does not supply access.

Every protected read obtains current policy, checks the complete published source
configuration digest, pins a validated generation, and revalidates immediately before
return. A concurrent change permits at most one retry. No stale authorization fallback
is used. Successful responses carry `policyRevision` independently of `revision`, the
exact immutable Git commit actually served. Empty authorized catalogs return `skills: []`;
missing membership/source binding returns unavailable. Unknown and forbidden names
within an authorized catalog both return `not_found`.

Generation slots are workspace-scoped `skills` slots; eligibility uses SHA-256 of the
complete canonical published source object, including credential alias. Recursive keys
sort in UTF-16 order and JSON has no whitespace. Access-only publications reuse validated
content. Changed source bindings block older content. Generations without verified binding
metadata are unavailable until rebuilt; there is no persistence import or epoch inference.
Source validation, source authorization refusal, freshness limits, memory accounting,
activation fencing, and pin/release remain independent controls.

`CATALOG_CURSOR_KEY_ALIAS` must resolve to a separate 32-byte key encoded as 64 hex
characters. Versioned AES-256-GCM cursors bind actor, workspace, source slot, binding,
policy revision, served commit and offset. Reuse in another actor/workspace fails;
publication changes require listing again. All instances must share the same cursor key.
Catalog audit records contain action/presence flags and outcome only. There is no
attachment, arbitrary path, filesystem loader, MCP resource alias or public content URL.

Set `POLICY_MODE=required` for deployments that require the policy service. Missing,
partial or invalid policy configuration fails before listening. Explicit optional mode
preserves unconfigured open-source tool behavior; protected catalog retrieval still
requires policy configuration. `INTROSPECTION_SERVICE_TOKEN` and the compatibility alias
`POLICY_INTROSPECTION_TOKEN` address one authenticated introspection route; the former
has precedence. The route requires a service token of at least 32 characters.

This slice qualifies synthetic pinned-source server behavior only. Release/main source
history, real client loading, deployment, and durable runtime qualification remain
separate work. Revocation affects later responses and cannot recall previously returned
text or unmanaged client copies.

## Source validation and refresh

A bounded GitHub adapter resolves immutable commits and validates the index plus original
UTF-8 documents before atomic activation. The five-minute refresh timer and authenticated
`/internal/org-skills/refresh` surface share one queue. Maximums include two concurrent
candidates, four concurrent downloads, 16 MiB per generation, 32 MiB active and 64 MiB
total retained document bytes; content becomes unavailable after one hour without a
successful verification. Failed validation keeps eligible last-good content, while source
authorization refusal immediately blocks that source. Source credentials require a nonempty
server-configured environment prefix and a validated policy-supplied alias.

The source-policy S3 object location is server configuration. It is read without an
authorization cache. Refresh routes mount before the global JSON parser, apply a small
body limit, authenticate a server secret, and bind it to one configured workspace.
Missing optional catalog configuration leaves the feature unavailable; complete but invalid
protected catalog configuration fails startup.
