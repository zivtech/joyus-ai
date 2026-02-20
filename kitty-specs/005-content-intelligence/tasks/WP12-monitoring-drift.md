---
work_package_id: WP12
title: Monitoring Pipeline + Drift Detection
lane: "for_review"
dependencies: [WP07, WP11]
subtasks: [T057, T058, T059, T060, T061, T062]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP12: Monitoring Pipeline + Drift Detection

## Objective

Continuous monitoring pipeline that queues Tier 2 deep analysis for every generated output, stores fidelity scores in JSON, computes daily/weekly rollups, and detects five drift signals with configurable thresholds and severity-based alerts.

## Implementation Command

```bash
spec-kitty implement WP12 --base WP07
```

**Note**: WP12 depends on both WP07 (Phase A complete) and WP11 (Phase B complete). Use `--base WP07` as the primary base since Phase A verification infrastructure is the direct prerequisite. WP11 models (hierarchy, attribution) should already be merged.

## Context

- **Spec**: spec.md §6 (System 3: Fidelity Monitoring & Repair)
- **Spec**: spec.md §6.2 (Continuous Monitoring), §6.3 (Drift Detection)
- **Data Model**: data-model.md §Monitoring Entities (DriftSignal, DriftDiagnosis, DriftedFeature)
- **API Contract**: contracts/mcp-tools-api.md §Monitoring Tools (check_drift, get_trends)
- **Success Criteria**: spec.md §10 (Drift detection <48h from onset to alert)

**Key design decisions from spec**:
- Tier 1 runs inline (<500ms); Tier 2 runs async after delivery
- Score storage is JSON-based (no database dependency)
- Five drift signals with distinct thresholds (spec §6.3)
- Severity levels: low, medium, high, critical
- Critical severity requires immediate notification

---

## Subtask T057: Monitoring Pipeline

**Purpose**: Queue and execute Tier 2 deep analysis on generated content asynchronously.

**Steps**:
1. Create `joyus_profile/monitor/pipeline.py`
2. Implement `MonitoringPipeline`:
   ```python
   class MonitoringPipeline:
       def __init__(self, score_store: ScoreStore, drift_detector: DriftDetector):
           self.score_store = score_store
           self.drift_detector = drift_detector
           self._queue: deque[MonitoringJob] = deque()

       def enqueue(self, content: str, profile_id: str, voice_key: str | None = None) -> str:
           """Queue content for Tier 2 analysis. Returns job_id."""
           job = MonitoringJob(
               job_id=cuid2(),
               content=content,
               profile_id=profile_id,
               voice_key=voice_key,
               queued_at=datetime.now(UTC),
           )
           self._queue.append(job)
           return job.job_id

       def process_next(self) -> MonitoringResult | None:
           """Process one queued job: run Tier 2, store score, check drift."""
           if not self._queue:
               return None
           job = self._queue.popleft()

           # 1. Run Tier 2 deep analysis
           scorer = FidelityScorer()
           score = scorer.score(job.content, self._load_profile(job.profile_id), tier="tier2")

           # 2. Store the score
           self.score_store.append(job.profile_id, score)

           # 3. Check for drift signals
           signals = self.drift_detector.check(job.profile_id)

           return MonitoringResult(job_id=job.job_id, score=score, drift_signals=signals)

       def process_all(self) -> list[MonitoringResult]:
           """Process all queued jobs."""
           results = []
           while self._queue:
               result = self.process_next()
               if result:
                   results.append(result)
           return results
   ```
3. Define `MonitoringJob` and `MonitoringResult` models
4. Pipeline is synchronous (designed to be called from `asyncio.to_thread()` by MCP layer)

**Files**:
- `joyus_profile/monitor/pipeline.py` (new, ~100 lines)
- `joyus_profile/monitor/__init__.py` (new)

**Validation**:
- [ ] Enqueue returns a job_id
- [ ] process_next() runs Tier 2 analysis and stores the score
- [ ] process_all() drains the queue
- [ ] Empty queue returns None gracefully

---

## Subtask T058: Score Storage

**Purpose**: JSON-based storage for fidelity scores with per-profile organization and time-series access.

**Steps**:
1. Create `joyus_profile/monitor/score_store.py`
2. Implement `ScoreStore`:
   ```python
   class ScoreStore:
       def __init__(self, data_dir: str):
           self.data_dir = Path(data_dir)

       def append(self, profile_id: str, score: FidelityScore) -> None:
           """Append a score to the profile's score file."""
           path = self._score_file(profile_id)
           path.parent.mkdir(parents=True, exist_ok=True)

           # Read existing scores
           scores = self._read_scores(profile_id)
           scores.append(score.model_dump())

           # Write back (atomic: write to tmp, rename)
           tmp = path.with_suffix(".tmp")
           tmp.write_text(json.dumps(scores, default=str, indent=2))
           tmp.rename(path)

       def get_scores(
           self,
           profile_id: str,
           window_start: datetime | None = None,
           window_end: datetime | None = None,
       ) -> list[FidelityScore]:
           """Get scores for a profile, optionally filtered by time window."""

       def get_latest(self, profile_id: str, n: int = 10) -> list[FidelityScore]:
           """Get the N most recent scores for a profile."""

       def _score_file(self, profile_id: str) -> Path:
           return self.data_dir / profile_id / "scores.json"

       def _read_scores(self, profile_id: str) -> list[dict]:
           path = self._score_file(profile_id)
           if not path.exists():
               return []
           return json.loads(path.read_text())
   ```
3. Storage layout:
   ```
   monitoring/
   ├── prof_abc123/
   │   ├── scores.json        # Time-series of FidelityScore entries
   │   └── rollups.json       # Daily/weekly aggregates
   ├── prof_def456/
   │   ├── scores.json
   │   └── rollups.json
   └── alerts.json            # Global alert log
   ```
4. Use atomic writes (write to `.tmp`, then rename) to prevent corruption

**Files**:
- `joyus_profile/monitor/score_store.py` (new, ~80 lines)

**Validation**:
- [ ] Append creates directory and file on first write
- [ ] Append adds to existing scores without overwriting
- [ ] get_scores() filters by time window correctly
- [ ] get_latest() returns most recent N scores in descending order
- [ ] Atomic writes: concurrent access doesn't corrupt the file

---

## Subtask T059: Daily/Weekly Rollups

**Purpose**: Aggregate raw scores into daily and weekly summaries for trend analysis.

**Steps**:
1. Add to `score_store.py` or create `joyus_profile/monitor/rollups.py`:
   ```python
   class RollupEngine:
       def __init__(self, score_store: ScoreStore):
           self.score_store = score_store

       def compute_daily(self, profile_id: str, date: date) -> DailyRollup:
           """Aggregate all scores for a profile on a specific date."""
           scores = self.score_store.get_scores(
               profile_id,
               window_start=datetime.combine(date, time.min, tzinfo=UTC),
               window_end=datetime.combine(date, time.max, tzinfo=UTC),
           )
           if not scores:
               return DailyRollup(date=date, count=0, mean=None, std=None, min=None, max=None)

           values = [s.score for s in scores]
           return DailyRollup(
               date=date,
               count=len(values),
               mean=statistics.mean(values),
               std=statistics.stdev(values) if len(values) > 1 else 0.0,
               min=min(values),
               max=max(values),
           )

       def compute_weekly(self, profile_id: str, week_start: date) -> WeeklyRollup:
           """Aggregate daily rollups into a weekly summary."""

       def get_trend(self, profile_id: str, window_days: int = 30,
                     granularity: str = "daily") -> TrendData:
           """Get fidelity trend data for the get_trends MCP tool."""
           # Returns: mean, std, trend slope, daily/weekly scores
   ```
2. Define `DailyRollup`, `WeeklyRollup`, `TrendData` models
3. Store rollups in `monitoring/{profile_id}/rollups.json`
4. Trend slope: simple linear regression on daily means (positive = improving, negative = declining)

**Files**:
- `joyus_profile/monitor/rollups.py` (new, ~90 lines)

**Validation**:
- [ ] Daily rollup computes correct mean/std/min/max
- [ ] Weekly rollup aggregates 7 daily rollups
- [ ] Trend slope is negative when scores are declining
- [ ] Empty days handled gracefully (skip, don't zero-fill)

---

## Subtask T060: Five Drift Detection Signals

**Purpose**: Implement the five drift signals from spec.md §6.3.

**Steps**:
1. Create `joyus_profile/monitor/drift_detector.py`
2. Implement `DriftDetector`:
   ```python
   class DriftDetector:
       def __init__(self, score_store: ScoreStore, config: DriftConfig):
           self.score_store = score_store
           self.config = config

       def check(self, profile_id: str) -> list[DriftSignal]:
           """Run all five drift checks for a profile. Returns detected signals."""
           signals = []
           scores = self.score_store.get_scores(
               profile_id,
               window_start=datetime.now(UTC) - timedelta(days=self.config.window_days),
           )
           if len(scores) < self.config.min_samples:
               return []  # Not enough data to detect drift

           signals.extend(self._check_fidelity_decline(profile_id, scores))
           signals.extend(self._check_marker_shift(profile_id, scores))
           signals.extend(self._check_stylometric_distance(profile_id, scores))
           signals.extend(self._check_negative_increase(profile_id, scores))
           signals.extend(self._check_inconsistency(profile_id, scores))

           return signals

       def _check_fidelity_decline(self, profile_id, scores) -> list[DriftSignal]:
           """Signal 1: Rolling average of Tier 2 scores dropping >5% over window."""
           # Split scores into first half and second half of window
           # Compare rolling means
           # If decline > threshold → emit signal

       def _check_marker_shift(self, profile_id, scores) -> list[DriftSignal]:
           """Signal 2: Signature phrase usage dropped >20%."""
           # Compare marker_score component across window
           # Baseline from first week, current from last week

       def _check_stylometric_distance(self, profile_id, scores) -> list[DriftSignal]:
           """Signal 3: Burrows' Delta trending away, exceeding 1.5x self-distance std."""
           # Use feature_breakdown["function_words"] as proxy for delta
           # Compare against baseline std

       def _check_negative_increase(self, profile_id, scores) -> list[DriftSignal]:
           """Signal 4: Prohibited framings appearing (any increase from zero baseline)."""
           # Check if any score has feedback mentioning prohibited framings
           # Or use dedicated anti-pattern score if available

       def _check_inconsistency(self, profile_id, scores) -> list[DriftSignal]:
           """Signal 5: Cross-document variance exceeding 2x historical variance."""
           # Compute variance of recent scores
           # Compare against historical variance
   ```
3. Each check returns a `DriftSignal` model (from data-model.md) with:
   - signal_type, severity, current_value, baseline_value, deviation, window dates, sample_count

**Files**:
- `joyus_profile/monitor/drift_detector.py` (new, ~150 lines)

**Validation**:
- [ ] Fidelity decline detected when scores drop >5% over 14 days
- [ ] Marker shift detected when marker_score drops >20%
- [ ] Stylometric distance detected when exceeding 1.5x std
- [ ] Negative increase detected when prohibited framings appear
- [ ] Inconsistency detected when variance doubles
- [ ] No false positives with insufficient data (<min_samples)

---

## Subtask T061: Configurable Thresholds Per Profile

**Purpose**: Allow per-profile threshold customization while providing sensible defaults.

**Steps**:
1. Create `joyus_profile/monitor/config.py`:
   ```python
   class DriftConfig(BaseModel):
       """Drift detection configuration. Override per-profile as needed."""
       window_days: int = 14
       min_samples: int = 5

       # Signal 1: Fidelity decline
       fidelity_decline_pct: float = 0.05  # 5% decline triggers

       # Signal 2: Marker shift
       marker_shift_pct: float = 0.20  # 20% drop in marker usage

       # Signal 3: Stylometric distance
       stylometric_multiplier: float = 1.5  # 1.5x self-distance std

       # Signal 4: Negative markers
       negative_zero_tolerance: bool = True  # Any increase triggers

       # Signal 5: Inconsistency
       inconsistency_multiplier: float = 2.0  # 2x historical variance

       # Severity mapping
       severity_rules: list[SeverityRule] = [
           SeverityRule(signal_count=1, min_severity="low"),
           SeverityRule(signal_count=2, min_severity="medium"),
           SeverityRule(signal_count=3, min_severity="high"),
           SeverityRule(signal_count=4, min_severity="critical"),
       ]
   ```
2. Load config from `monitoring/{profile_id}/config.json` with fallback to defaults
3. Config is a Pydantic model — validates on load

**Files**:
- `joyus_profile/monitor/config.py` (new, ~50 lines)

**Validation**:
- [ ] Default config loads without a config file
- [ ] Per-profile config overrides defaults
- [ ] Invalid config values rejected by Pydantic validation

---

## Subtask T062: Alert Generation with Severity

**Purpose**: Generate alerts when drift is detected, with severity classification.

**Steps**:
1. Create `joyus_profile/monitor/alerts.py`:
   ```python
   class AlertGenerator:
       def __init__(self, data_dir: str):
           self.alerts_file = Path(data_dir) / "alerts.json"

       def generate_alerts(self, profile_id: str, signals: list[DriftSignal]) -> list[Alert]:
           """Convert drift signals into alerts with severity classification."""
           if not signals:
               return []

           # Compute aggregate severity
           severity = self._compute_severity(signals)

           alert = Alert(
               alert_id=cuid2(),
               profile_id=profile_id,
               severity=severity,
               signals=signals,
               summary=self._build_summary(signals),
               created_at=datetime.now(UTC),
               acknowledged=False,
           )

           # Store alert
           self._store_alert(alert)

           return [alert]

       def _compute_severity(self, signals: list[DriftSignal]) -> str:
           """Aggregate severity from individual signals."""
           # Take the max severity from all signals
           severity_order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
           max_severity = max(severity_order[s.severity] for s in signals)
           # Escalate if multiple signals
           if len(signals) >= 3 and max_severity < 2:
               max_severity = 2  # 3+ signals → at least "high"
           return {v: k for k, v in severity_order.items()}[max_severity]

       def _build_summary(self, signals: list[DriftSignal]) -> str:
           """Human-readable alert summary."""

       def get_alerts(self, profile_id: str | None = None,
                      acknowledged: bool | None = None) -> list[Alert]:
           """Query alerts with optional filters."""

       def acknowledge(self, alert_id: str) -> None:
           """Mark an alert as acknowledged."""
   ```
2. Define `Alert` model:
   - alert_id, profile_id, severity, signals, summary, created_at, acknowledged
3. Alerts stored in `monitoring/alerts.json` (append-only, global)
4. Critical alerts include a flag for immediate notification (spec: critical requires immediate notification)

**Files**:
- `joyus_profile/monitor/alerts.py` (new, ~80 lines)

**Validation**:
- [ ] Single signal → alert with signal's severity
- [ ] 3+ signals → severity escalated to at least "high"
- [ ] Critical signal → critical alert with immediate flag
- [ ] Alert stored and queryable
- [ ] Acknowledge marks alert as read

---

## Definition of Done

- [ ] Monitoring pipeline queues and processes Tier 2 analysis
- [ ] Score storage persists scores per profile in JSON
- [ ] Daily/weekly rollups compute correct aggregates
- [ ] All five drift signals implemented with correct thresholds
- [ ] Per-profile config overrides supported
- [ ] Alerts generated with severity classification
- [ ] All tests pass

## Risks

- **Score file growth**: JSON files grow unbounded. Consider rotation or archival for profiles with high output volume.
- **Threshold calibration**: Default thresholds (5%, 20%, 1.5x, etc.) come from the spec but may need empirical tuning.
- **Concurrent access**: Atomic writes help but aren't true file locking. Sufficient for single-process use; needs locking for multi-process.

## Activity Log

- 2026-02-20T13:40:56Z – unknown – lane=doing – Implementation started by claude-lead
- 2026-02-20T13:48:16Z – unknown – lane=for_review – 70 tests passing, all 6 subtasks done
