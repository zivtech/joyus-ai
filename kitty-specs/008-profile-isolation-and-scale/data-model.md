# Data Model: Profile Isolation and Scale

## Entities

### Profile
- id: string (cuid2)
- tenantId: string
- authorName: string
- authorType: enum (person, organization)
- status: enum (pending_training, active, archived)
- currentVersionId: string | null
- currentVersion: string | null (e.g., "1.0", "1.1", "2.0")
- lastRetrainedAt: timestamp | null
- stalenessThresholdDays: int (default: 30)
- isStale: boolean (computed on query)
- createdAt: timestamp
- updatedAt: timestamp

### ProfileVersion
- id: string (cuid2)
- profileId: string
- tenantId: string
- versionNumber: string (e.g., "1.0", "1.1", "2.0")
- featureVectorId: string
- trainingCorpusSize: int
- trainingDocumentIds: string[]
- accuracyScore: number (0.0–1.0)
- createdAt: timestamp

### FeatureVector
- id: string (cuid2)
- profileId: string
- versionId: string
- tenantId: string
- vector: jsonb (129-dimensional float64 array)
- dimensionCount: int (default: 129)
- createdAt: timestamp

### ProfileAuditEntry
- id: string (cuid2)
- tenantId: string
- profileId: string
- userId: string
- action: enum (read, create, update, delete, use_in_generation, version_pin, retrain, access_denied)
- result: enum (allowed, denied)
- requestContext: jsonb | null
- timestamp: timestamp

### BatchIngestionJob
- id: string (cuid2)
- profileId: string
- tenantId: string
- status: enum (pending, running, completed, failed, cancelled)
- totalDocuments: int
- processedDocuments: int
- failedDocuments: int
- documentIds: string[]
- accuracyScore: number | null
- errorLog: jsonb | null
- createdAt: timestamp
- updatedAt: timestamp
- completedAt: timestamp | null

### ProfileCache
- key: string (tenantId:profileId:version)
- featureVector: FeatureVector
- ttlSeconds: int (default: 3600)
- maxSize: int (default: 1000)
- cachedAt: timestamp

### ProfileEngineClient
- interface only (no database table)
- extractFeatures(documents: string[]): Promise\<FeatureVector\>
- computeSimilarity(vectorA: FeatureVector, vectorB: FeatureVector): Promise\<number\>
- trainProfile(documents: string[]): Promise\<TrainedProfile\>

### DriftRetrainingEvent
- id: string (cuid2)
- profileId: string
- tenantId: string
- driftScore: number
- threshold: number
- triggeredAt: timestamp
- status: enum (pending, enqueued, completed, skipped)
- retrainingJobId: string | null
