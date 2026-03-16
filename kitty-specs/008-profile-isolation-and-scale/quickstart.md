# Quickstart: Profile Isolation and Scale

## 1) Create a profile and trigger initial training

```bash
curl -X POST /api/profiles \
  -H "Content-Type: application/json" \
  -d '{"authorName": "Jane Smith", "authorType": "person", "documentIds": ["doc_01", "doc_02"]}'
```

The platform creates a profile, enqueues a batch ingestion job, and trains version 1.0.

## 2) Check batch ingestion progress

```bash
curl /api/profiles/:id/jobs/:jobId
# Returns: { processedDocuments: 42, totalDocuments: 50, status: "running" }
```

## 3) Trigger retraining and check version history

```bash
curl -X POST /api/profiles/:id/retrain \
  -H "Content-Type: application/json" \
  -d '{"documentIds": ["doc_03", "doc_04", "doc_05"]}'

curl /api/profiles/:id/versions
# Returns list of versions: 1.0, 1.1
```

## 4) Diff two versions

```bash
curl /api/profiles/:id/diff/1.0/1.1
# Returns structured diff: which features changed, magnitude, direction
```

## 5) Pin a version for generation

```bash
curl -X POST /api/profiles/:id/pin \
  -H "Content-Type: application/json" \
  -d '{"version": "1.0"}'
```

Pinning ensures a pipeline or generation request continues using version 1.0 even after newer versions are created.

## 6) Check staleness

```bash
curl /api/profiles/:id
# Returns: { isStale: true, lastRetrainedAt: "2026-02-14T10:00:00Z", ... }
```

Stale profiles (not retrained within `stalenessThresholdDays`) remain usable but carry `isStale: true` in all responses.

## 7) Query audit log

```bash
curl /api/profiles/:id/audit?limit=50
# Returns: tenant-scoped log of all read, create, update, pin, and denied access events
```
