---
work_package_id: WP10
title: Voice Drift Monitoring
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:54:12.185611+00:00'
subtasks: [T046, T047, T048, T049]
shell_pid: "60396"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP10: Voice Drift Monitoring

## Objective

Build the background voice drift monitoring system: define the VoiceAnalyzer interface, schedule periodic drift evaluation of generated content, produce drift reports with dimension-level scores, and integrate drift scores back into generation logs.

## Implementation Command

```bash
spec-kitty implement WP10 --base WP06
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-018, FR-019, SC-008)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R8: Voice Drift Monitoring)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (DriftReport, GenerationLog.driftScore)

Drift monitoring is explicitly background-only — NOT per-generation gating. The profile engine (Feature 005, private repo) provides the actual analysis; this feature defines the integration interface and scheduling. A stub/mock VoiceAnalyzer ships for testing; real implementations are provided by deployment configuration.

---

## Subtask T046: Define VoiceAnalyzer Interface

**Purpose**: Abstract interface for voice analysis backends.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/interface.ts`
2. Define:
   ```typescript
   export interface VoiceAnalyzer {
     analyze(content: string, profileId: string, tenantId: string): Promise<DriftAnalysis>;
   }

   export interface DriftAnalysis {
     overallScore: number;  // 0.0 = perfect match, 1.0 = max drift
     dimensionScores: Record<string, number>;  // e.g., { formality: 0.1, complexity: 0.3 }
     sampleSize: number;
     recommendations: string[];
   }
   ```
3. Create a `StubVoiceAnalyzer` for testing:
   ```typescript
   export class StubVoiceAnalyzer implements VoiceAnalyzer {
     async analyze(_content: string, _profileId: string, _tenantId: string): Promise<DriftAnalysis> {
       return {
         overallScore: 0.0,
         dimensionScores: {},
         sampleSize: 0,
         recommendations: ['Voice analysis not configured — install a VoiceAnalyzer provider'],
       };
     }
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/interface.ts` (new, ~40 lines)

**Validation**:
- [ ] Interface is clean and implementation-agnostic
- [ ] Stub analyzer returns safe defaults

---

## Subtask T047: Create Drift Monitor Scheduler

**Purpose**: Background cron job that periodically evaluates recent generations for voice drift.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/drift.ts`
2. Implement:
   ```typescript
   export class DriftMonitor {
     constructor(
       private analyzer: VoiceAnalyzer,
       private db: DrizzleClient
     ) {}

     async evaluateRecentGenerations(windowHours: number = 24): Promise<void> {
       // 1. Query generation_logs where driftScore IS NULL
       //    AND profileId IS NOT NULL
       //    AND createdAt >= now() - windowHours
       // 2. Group by profileId
       // 3. For each profile:
       //    a. Get all unscored generations
       //    b. Call analyzer.analyze() for each
       //    c. Update generation_logs.driftScore
       //    d. Create/update DriftReport for this profile + window
     }

     start(intervalMinutes: number = 60): void {
       // Schedule via node-cron or setInterval
     }

     stop(): void {
       // Clear interval
     }
   }
   ```
3. Process in batches (max 100 generations per evaluation cycle) to avoid overloading
4. Only evaluate generations that have a profileId (skip unprofile'd generations)

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/drift.ts` (new, ~100 lines)

**Validation**:
- [ ] Only evaluates unscored generations with a profileId
- [ ] Processes in batches
- [ ] Scheduler starts and stops cleanly
- [ ] SC-008: Reports available within 24 hours of generation

---

## Subtask T048: Implement Drift Report Generation

**Purpose**: Aggregate individual drift scores into profile-level drift reports.

**Steps**:
1. Add to `drift.ts` or create `monitoring/reports.ts`:
   ```typescript
   export async function generateDriftReport(
     tenantId: string,
     profileId: string,
     windowStart: Date,
     windowEnd: Date,
     analyses: DriftAnalysis[]
   ): Promise<DriftReport> {
     // 1. Aggregate overallScore (mean across analyses)
     // 2. Aggregate dimensionScores (mean per dimension)
     // 3. Collect unique recommendations
     // 4. Create DriftReport record:
     //    - tenantId, profileId, windowStart, windowEnd
     //    - generationsEvaluated: analyses.length
     //    - overallDriftScore: aggregated mean
     //    - dimensionScores: aggregated per-dimension
     //    - recommendations: collected from analyses
     // 5. Insert into content.drift_reports
     // 6. Return the created report
   }
   ```
2. Handle edge case: 0 analyses → skip report creation

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/drift.ts` (extend, ~50 lines)

**Validation**:
- [ ] Report aggregates correctly from individual analyses
- [ ] Dimension scores averaged across all analyses
- [ ] Recommendations deduplicated
- [ ] No report created for empty windows

---

## Subtask T049: Integrate Drift Scores with Generation Logs

**Purpose**: Back-populate the `driftScore` field on generation log records after analysis.

**Steps**:
1. In the drift evaluation loop (T047), after calling `analyzer.analyze()`:
   ```typescript
   await db.update(generationLogs)
     .set({ driftScore: analysis.overallScore })
     .where(eq(generationLogs.id, logId));
   ```
2. Add a query helper for drift tools:
   ```typescript
   export async function getLatestDriftReport(
     tenantId: string,
     profileId: string,
     windowDays?: number
   ): Promise<DriftReport | null>;

   export async function getDriftSummary(
     tenantId: string
   ): Promise<DriftSummaryEntry[]>;
   ```
3. `getDriftSummary` returns one entry per monitored profile with latest drift score and trend

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/drift.ts` (extend, ~50 lines)

**Validation**:
- [ ] Generation logs updated with drift scores
- [ ] Latest drift report retrievable per profile
- [ ] Summary covers all monitored profiles

---

## Definition of Done

- [ ] VoiceAnalyzer interface defined with stub implementation
- [ ] Drift monitor scheduler runs as background job
- [ ] Drift reports generated from aggregated analysis results
- [ ] Generation logs back-populated with drift scores
- [ ] Query helpers for drift tools (WP07)
- [ ] `npm run typecheck` passes

## Risks

- **No concrete VoiceAnalyzer**: This WP ships with a stub. Actual analysis requires profile engine integration (deployment-time concern). Tests should use the stub.
- **Evaluation volume**: Large numbers of unscored generations could slow the evaluation cycle. Batch processing (max 100) mitigates this.

## Reviewer Guidance

- Verify drift monitoring is BACKGROUND only (no per-generation blocking)
- Check that stub analyzer returns safe defaults (not fake data that could mislead)
- Confirm batch processing limit is enforced
- Verify generation log updates use correct WHERE clause (only update the specific log)

## Activity Log

- 2026-02-21T13:01:25Z – unknown – shell_pid=60396 – lane=done – Drift monitoring complete
