---
work_package_id: WP14
title: Monitoring MCP Tools + Testing
lane: "doing"
dependencies: [WP13]
subtasks: [T069, T070, T071, T072, T073]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP14: Monitoring MCP Tools + Testing

## Objective

Expose monitoring, drift, and repair as MCP tools; integrate with Langfuse for observability; and run comprehensive drift simulation, repair verification, and cross-profile regression scenarios.

## Implementation Command

```bash
spec-kitty implement WP14 --base WP13
```

## Context

- **Spec**: spec.md §6 (System 3: Fidelity Monitoring & Repair)
- **API Contract**: contracts/mcp-tools-api.md §Monitoring Tools (check_drift, get_trends, trigger_repair)
- **Success Criteria**: spec.md §10 (Drift detection <48h from onset to alert, generated content fidelity >=0.80)
- **Data Model**: data-model.md §Monitoring Entities

**MCP tools to implement** (from contracts/mcp-tools-api.md):
1. `check_drift` — Check for quality drift on a specific profile
2. `get_trends` — Get fidelity trends over time
3. `trigger_repair` — Propose or execute a repair action

---

## Subtask T069: Monitoring MCP Tools

**Purpose**: Expose monitoring, drift detection, and repair as MCP tools using the official Python `mcp` SDK.

**Steps**:
1. Create `joyus_profile/mcp_server/tools/monitor_tools.py`
2. Register 3 tools matching the API contract:
   ```python
   from mcp.server import Server
   from mcp.types import Tool

   def register_monitor_tools(server: Server):
       @server.tool()
       async def check_drift(
           profile_id: str,
           data_dir: str,
           window_days: int = 14,
       ) -> dict:
           """Check for quality drift on a specific profile."""
           def _run():
               store = ScoreStore(data_dir)
               config = DriftConfig(window_days=window_days)
               detector = DriftDetector(store, config)
               signals = detector.check(profile_id)

               if not signals:
                   return {"drift_detected": False, "signals": [], "diagnosis": None}

               engine = DiagnosisEngine(store, detector)
               diagnosis = engine.diagnose(profile_id, signals)

               return {
                   "drift_detected": True,
                   "signals": [_format_signal(s) for s in signals],
                   "diagnosis": {
                       "probable_cause": diagnosis.probable_cause,
                       "affected_features": [f.feature_name for f in diagnosis.affected_features],
                       "recommended_action": diagnosis.recommended_action.action_type,
                       "description": diagnosis.recommended_action.description,
                   },
               }

           return await asyncio.to_thread(_run)

       @server.tool()
       async def get_trends(
           profile_id: str,
           data_dir: str,
           window_days: int = 30,
           granularity: str = "daily",
       ) -> dict:
           """Get fidelity trends for a profile over time."""
           def _run():
               store = ScoreStore(data_dir)
               rollups = RollupEngine(store)
               trend = rollups.get_trend(profile_id, window_days, granularity)
               alerts = AlertGenerator(data_dir).get_alerts(profile_id=profile_id)

               return {
                   "profile_id": profile_id,
                   "window": {
                       "start": trend.window_start.isoformat(),
                       "end": trend.window_end.isoformat(),
                   },
                   "sample_count": trend.sample_count,
                   "trend": {
                       "fidelity_mean": trend.mean,
                       "fidelity_std": trend.std,
                       "fidelity_trend": trend.slope,
                       "daily_scores": [
                           {"date": r.date.isoformat(), "mean": r.mean, "count": r.count}
                           for r in trend.rollups
                       ],
                   },
                   "alerts": [{"severity": a.severity, "summary": a.summary} for a in alerts],
               }

           return await asyncio.to_thread(_run)

       @server.tool()
       async def trigger_repair(
           diagnosis_id: str,
           action: str,
           auto_apply: bool = False,
       ) -> dict:
           """Propose or execute a repair action."""
           def _run():
               framework = RepairFramework(data_dir)
               diagnosis = framework.load_diagnosis(diagnosis_id)

               repair = framework.propose(diagnosis)

               if auto_apply and repair.automated:
                   repair = framework.apply(repair.action_id)

               return {
                   "action_id": repair.action_id,
                   "status": repair.status,
                   "description": repair.description,
                   "changes": {},  # Populated by handler
                   "requires_approval": not repair.automated,
               }

           return await asyncio.to_thread(_run)
   ```
3. Register in the main server entry point alongside profile and attribution tools
4. All sync calls wrapped in `asyncio.to_thread()` (same pattern as WP06)

**Files**:
- `joyus_profile/mcp_server/tools/monitor_tools.py` (new, ~120 lines)

**Validation**:
- [ ] `check_drift` returns signals and diagnosis when drift exists
- [ ] `check_drift` returns empty signals when no drift
- [ ] `get_trends` returns correct trend data with daily scores
- [ ] `trigger_repair` creates a repair proposal
- [ ] `trigger_repair` with `auto_apply=True` applies automated repairs
- [ ] All tools callable via MCP

---

## Subtask T070: Langfuse Integration Hooks

**Purpose**: Integrate with Langfuse for monitoring observability — trace every verification and drift check.

**Steps**:
1. Create `joyus_profile/monitor/observability.py`:
   ```python
   class ObservabilityHooks:
       """Optional Langfuse integration for monitoring traces."""

       def __init__(self, langfuse_client=None):
           self.langfuse = langfuse_client  # None if Langfuse not configured

       def trace_verification(self, profile_id: str, score: FidelityScore) -> None:
           """Log a verification score to Langfuse."""
           if not self.langfuse:
               return
           self.langfuse.trace(
               name="fidelity_verification",
               metadata={
                   "profile_id": profile_id,
                   "tier": score.tier,
                   "score": score.score,
                   "passed": score.passed,
               },
           )

       def trace_drift_check(self, profile_id: str, signals: list[DriftSignal]) -> None:
           """Log drift detection results to Langfuse."""
           if not self.langfuse:
               return
           self.langfuse.trace(
               name="drift_check",
               metadata={
                   "profile_id": profile_id,
                   "signal_count": len(signals),
                   "drift_detected": len(signals) > 0,
                   "signal_types": [s.signal_type for s in signals],
               },
           )

       def trace_repair(self, action: RepairAction) -> None:
           """Log repair lifecycle events to Langfuse."""
           if not self.langfuse:
               return
           self.langfuse.trace(
               name="repair_action",
               metadata={
                   "action_id": action.action_id,
                   "action_type": action.action_type,
                   "status": action.status,
               },
           )
   ```
2. Integration is optional — hooks are no-ops when Langfuse is not configured
3. Wire hooks into `MonitoringPipeline.process_next()`, `DriftDetector.check()`, and `RepairFramework.apply()`
4. Langfuse client provided via dependency injection (not hardcoded)

**Files**:
- `joyus_profile/monitor/observability.py` (new, ~60 lines)

**Validation**:
- [ ] Hooks are no-ops when langfuse_client is None
- [ ] Verification traces include profile_id, tier, score, passed
- [ ] Drift check traces include signal count and types
- [ ] Repair traces include action lifecycle status
- [ ] No import errors when Langfuse package is not installed

---

## Subtask T071: Simulated Drift Scenarios

**Purpose**: Create test fixtures and scenarios that simulate realistic drift patterns.

**Steps**:
1. Create `tests/integration/test_drift_simulation.py`:
   ```python
   class TestDriftSimulation:
       def test_gradual_fidelity_decline(self, score_store, drift_detector):
           """Simulate gradual score decline over 14 days."""
           # Generate 14 days of scores with declining trend
           baseline_score = 0.85
           for day in range(14):
               score = baseline_score - (day * 0.005)  # 0.5% decline per day = 7% total
               score_store.append("test_profile", make_score(
                   score=score,
                   timestamp=base_date + timedelta(days=day),
               ))

           signals = drift_detector.check("test_profile")
           assert any(s.signal_type == "fidelity_decline" for s in signals)

       def test_marker_shift(self, score_store, drift_detector):
           """Simulate signature phrase usage dropping."""
           # First week: marker_score ~0.80
           # Second week: marker_score ~0.55 (>20% decline)
           # ...
           signals = drift_detector.check("test_profile")
           assert any(s.signal_type == "marker_shift" for s in signals)

       def test_sudden_prohibited_framing(self, score_store, drift_detector):
           """Simulate prohibited framings appearing in outputs."""
           # Scores with negative marker indicators
           # ...
           signals = drift_detector.check("test_profile")
           assert any(s.signal_type == "negative_increase" for s in signals)

       def test_no_drift_stable_scores(self, score_store, drift_detector):
           """Stable scores should produce no drift signals."""
           for day in range(14):
               score_store.append("test_profile", make_score(
                   score=0.82 + random.uniform(-0.02, 0.02),
                   timestamp=base_date + timedelta(days=day),
               ))
           signals = drift_detector.check("test_profile")
           assert len(signals) == 0

       def test_insufficient_data(self, score_store, drift_detector):
           """Fewer than min_samples should produce no signals."""
           score_store.append("test_profile", make_score(score=0.50))
           signals = drift_detector.check("test_profile")
           assert len(signals) == 0

       def test_drift_detection_time(self, score_store, drift_detector):
           """Verify drift detected within 48 hours of onset (spec §10)."""
           # Insert declining scores starting at t=0
           # Check that signals appear when window covers 48h of data
   ```
2. Create `tests/fixtures/monitoring/` with pre-built score histories
3. Test helper: `make_score()` creates a FidelityScore with customizable fields

**Files**:
- `tests/integration/test_drift_simulation.py` (new, ~120 lines)
- `tests/fixtures/monitoring/` (new, score fixture files)

**Validation**:
- [ ] Gradual decline detected after sufficient data
- [ ] Marker shift detected with >20% drop
- [ ] Prohibited framings trigger immediate signal
- [ ] Stable scores produce no false positives
- [ ] Insufficient data handled gracefully
- [ ] Detection time <48h from onset

---

## Subtask T072: Repair Verification Tests

**Purpose**: Test the full repair lifecycle: propose → approve → apply → verify → confirm/revert.

**Steps**:
1. Create `tests/integration/test_repair_lifecycle.py`:
   ```python
   class TestRepairLifecycle:
       def test_full_repair_happy_path(self, repair_framework, verifier):
           """Propose → approve → apply → verify → status=verified."""
           # 1. Create diagnosis with marker_shift
           diagnosis = make_diagnosis(cause="vocabulary_shift")

           # 2. Propose repair
           action = repair_framework.propose(diagnosis)
           assert action.status == "proposed"

           # 3. Approve
           action = repair_framework.approve(action.action_id)
           assert action.status == "approved"

           # 4. Apply
           action = repair_framework.apply(action.action_id)
           assert action.status == "applied"

           # 5. Verify
           result = verifier.verify(action, diagnosis.profile_id)
           assert result.regression_passed
           assert result.forward_passed
           assert result.cross_profile_passed

       def test_repair_verification_failure_triggers_revert(self):
           """When verification fails, repair should be reverted."""
           # Apply a repair that causes regression failure
           # Verify → fails
           # Revert → status=reverted
           # Original state restored

       def test_automated_repair_skips_approval(self):
           """recalibrate_thresholds can be auto-applied."""
           diagnosis = make_diagnosis(cause="model_update")
           action = repair_framework.propose(diagnosis)
           # auto_apply=True should work for automated repairs
           action = repair_framework.apply(action.action_id)
           assert action.status == "applied"

       def test_non_automated_repair_requires_approval(self):
           """rebuild_profile cannot be applied without approval."""
           diagnosis = make_diagnosis(cause="profile_staleness")
           action = repair_framework.propose(diagnosis)
           with pytest.raises(ValueError, match="require"):
               repair_framework.apply(action.action_id)

       def test_reject_repair(self):
           """Rejected repairs stay in rejected state."""
           action = repair_framework.propose(make_diagnosis())
           action = repair_framework.reject(action.action_id, "Not appropriate")
           assert action.status == "rejected"
   ```

**Files**:
- `tests/integration/test_repair_lifecycle.py` (new, ~100 lines)

**Validation**:
- [ ] Full happy path: propose → approve → apply → verify
- [ ] Failed verification triggers revert path
- [ ] Automated repairs skip approval
- [ ] Non-automated repairs require approval
- [ ] Rejected repairs stay rejected

---

## Subtask T073: Cross-Profile Regression Tests

**Purpose**: Verify that repairs and monitoring don't affect unrelated profiles.

**Steps**:
1. Create `tests/regression/test_monitoring_regression.py`:
   ```python
   class TestMonitoringRegression:
       def test_repair_doesnt_affect_other_profiles(self, hierarchy, repair_framework):
           """Repairing profile A should not change profile B's scores."""
           # 1. Score profile B before repair
           pre_scores = score_profiles(hierarchy, exclude="prof_a")

           # 2. Apply repair to profile A
           diagnosis = make_diagnosis(profile_id="prof_a")
           action = repair_framework.propose(diagnosis)
           repair_framework.approve(action.action_id)
           repair_framework.apply(action.action_id)

           # 3. Score profile B after repair
           post_scores = score_profiles(hierarchy, exclude="prof_a")

           # 4. Scores should be unchanged
           for profile_id in pre_scores:
               assert abs(pre_scores[profile_id] - post_scores[profile_id]) < 0.01

       def test_monitoring_pipeline_end_to_end(self, pipeline, hierarchy):
           """Full pipeline: generate → enqueue → process → check drift → diagnose."""
           # 1. Generate content against a profile
           # 2. Enqueue for monitoring
           # 3. Process (Tier 2 analysis)
           # 4. Repeat with degrading scores
           # 5. Check drift → should detect
           # 6. Diagnose → should identify cause

       def test_alert_severity_escalation(self, alert_generator):
           """Multiple signals escalate severity correctly."""
           # 1 signal → low
           # 2 signals → medium
           # 3 signals → high (escalation rule)
           # critical signal → always critical

       def test_rollup_accuracy(self, score_store, rollup_engine):
           """Rollups accurately reflect raw scores."""
           # Insert known scores
           # Compute rollups
           # Verify mean, std, min, max match manual calculation
   ```

**Files**:
- `tests/regression/test_monitoring_regression.py` (new, ~80 lines)

**Validation**:
- [ ] Repairs are profile-isolated (no cross-profile contamination)
- [ ] End-to-end pipeline produces expected results
- [ ] Alert severity escalation works correctly
- [ ] Rollups match manual calculations

---

## Definition of Done

- [ ] All 3 monitoring MCP tools callable and returning correct responses
- [ ] Langfuse hooks integrated (no-op when not configured)
- [ ] Drift simulation tests cover all 5 signal types
- [ ] Repair lifecycle tests cover happy path, failure/revert, and edge cases
- [ ] Cross-profile regression tests confirm isolation
- [ ] All tests pass

## Risks

- **Langfuse dependency**: Langfuse is optional but the integration code must not break when the package isn't installed. Use conditional imports.
- **Simulated drift realism**: Synthetic drift scenarios may not cover all real-world patterns. Document known limitations and plan for empirical testing with real data.
- **Repair handler stubs**: Some handlers (rebuild_profile, update_corpus) depend on the full profile building pipeline. They may need to be integration-tested separately once Phase A is fully wired up.

## Activity Log

- 2026-02-20T13:53:47Z – unknown – lane=doing – Worktree prepared, waiting for WP13 completion
