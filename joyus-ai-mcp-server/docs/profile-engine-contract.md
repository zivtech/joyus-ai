# Profile Engine Contract

`profile_generate` integrates with a separately deployed profile engine through
a CLI subprocess contract. The public platform owns tenant scoping, corpus
snapshot selection, generation run state, and profile storage. The engine only
receives a temporary directory containing the selected snapshot's extracted
text plus the requested author identifier.

## Configuration

Set these environment variables when an engine is available:

```bash
export PROFILE_ENGINE_COMMAND="joyus-profile"
export PROFILE_ENGINE_ARGS="generate"
export PROFILE_ENGINE_HEALTH_ARGS="health-check"
```

Leave `PROFILE_ENGINE_COMMAND` unset when no engine is available. In that state,
`profile_generate` creates a generation run, marks it failed with a clear
not-configured error, and does not create profile rows.

## Generate Invocation

The bridge invokes:

```text
<PROFILE_ENGINE_COMMAND> <PROFILE_ENGINE_ARGS> \
  --corpus-path <tenant-scoped-snapshot-directory> \
  --author-id <author-id> \
  --output-format json \
  [--engine-version <version>]
```

The corpus path is a temporary directory materialized by this server from the
selected corpus snapshot. It is not a tenant ID, snapshot ID, database key, or
deployment-specific path.

## Generate Response

The engine must write one JSON object to stdout:

```json
{
  "authorId": "author-001",
  "stylometricFeatures": {
    "sentence_length_stats.mean": 18.4
  },
  "markers": [
    {
      "signal": "high",
      "text": "structured claims",
      "weight": 0.8,
      "frequency": 0.2,
      "domain": "general"
    }
  ],
  "fidelityScore": 0.91,
  "engineVersion": "0.1.0"
}
```

Contract rules:

- `authorId` is required and must match the requested author.
- `stylometricFeatures` is a string-keyed object whose values are numbers.
- `markers` is an array. Marker object fields may evolve, but the array shape is stable.
- `fidelityScore` is required and may be `null` when the engine cannot score yet.
- `engineVersion` is a required string identifying the engine contract/model version.
- `durationMs` is owned by the TypeScript bridge and must not be required from the engine.

## Health Check

The bridge invokes:

```text
<PROFILE_ENGINE_COMMAND> <PROFILE_ENGINE_HEALTH_ARGS>
```

Exit code `0` means healthy. Non-zero exits, timeouts, or missing configuration
mean unhealthy.

## Failure Semantics

For validation failures, the engine should exit non-zero and write a concise
machine-readable error to stderr. The public platform stores a failed generation
run and avoids exposing tenant IDs, snapshot IDs, filesystem paths, or raw corpus
content in user-facing tool responses.
