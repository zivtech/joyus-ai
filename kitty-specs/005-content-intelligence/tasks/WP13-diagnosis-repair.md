---
work_package_id: WP13
title: Drift Diagnosis + Repair Framework
lane: "done"
dependencies: [WP12]
subtasks: [T063, T064, T065, T066, T067, T068]
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP13: Drift Diagnosis + Repair Framework

## Objective

Diagnosis engine that identifies what specifically drifted and the probable cause, plus a repair action framework with 6 repair types, human-in-the-loop approval, post-repair verification, and revert capability.

## Implementation Command

```bash
spec-kitty implement WP13 --base WP12
```

## Context

- **Spec**: spec.md §6.4 (Diagnosis), §6.5 (Repair Actions), §6.6 (Repair Verification)
- **Data Model**: data-model.md §DriftDiagnosis, §DriftedFeature, §RepairAction, §RepairVerification
- **API Contract**: contracts/mcp-tools-api.md §Monitoring Tools (trigger_repair)

**Repair lifecycle from spec §6.6**:
```
Drift detected → Diagnose → Propose repair → Human approves
    → Apply repair → Regression test → Forward test → Cross-profile check
        → If all pass: deploy updated profiles
        → If any fail: revert repair, escalate to human
```

**Six repair types** (spec §6.5):
1. `rebuild_profile` — Re-run profile building on expanded corpus
2. `update_markers` — Add new domain terms, retire obsolete ones
3. `recalibrate_thresholds` — Adjust Tier 1 thresholds against known-good samples
4. `update_positions` — Update positions in profile hierarchy (may cascade)
5. `update_corpus` — Rebuild from updated corpus (author published new work)
6. `escalate` — Escalate to human with full diagnostic report

---

## Subtask T063: Diagnosis Engine

**Purpose**: Analyze drift signals to identify what specifically drifted and determine the probable cause.

**Steps**:
1. Create `joyus_profile/monitor/diagnosis.py`
2. Implement `DiagnosisEngine`:
   ```python
   class DiagnosisEngine:
       def __init__(self, score_store: ScoreStore, drift_detector: DriftDetector):
           self.score_store = score_store
           self.drift_detector = drift_detector

       def diagnose(self, profile_id: str, signals: list[DriftSignal]) -> DriftDiagnosis:
           """Analyze drift signals and produce a diagnosis."""
           # 1. Identify affected features
           affected = self._identify_affected_features(profile_id, signals)

           # 2. Determine probable cause
           cause = self._determine_cause(signals, affected)

           # 3. Compute severity (aggregate from signals)
           severity = self._aggregate_severity(signals)

           # 4. Recommend repair action
           action = self._recommend_repair(cause, severity, affected)

           return DriftDiagnosis(
               diagnosis_id=cuid2(),
               profile_id=profile_id,
               detection_date=datetime.now(UTC),
               severity=severity,
               signals=signals,
               affected_features=affected,
               probable_cause=cause,
               recommended_action=action,
               diagnosed_at=datetime.now(UTC),
           )

       def _determine_cause(
           self, signals: list[DriftSignal], features: list[DriftedFeature]
       ) -> str:
           """Map signal patterns to probable causes."""
           signal_types = {s.signal_type for s in signals}

           # Heuristic cause mapping:
           if "negative_increase" in signal_types:
               return "position_change"  # Prohibited framings suggest stance shift
           if "marker_shift" in signal_types and "stylometric_distance" not in signal_types:
               return "vocabulary_shift"  # Markers changed but core style stable
           if "stylometric_distance" in signal_types and "marker_shift" in signal_types:
               return "corpus_evolution"  # Both style and markers shifted
           if "inconsistency" in signal_types and len(signal_types) == 1:
               return "model_update"  # Outputs vary but profile didn't change
           if "fidelity_decline" in signal_types and len(signal_types) == 1:
               return "profile_staleness"  # Gradual decline, no specific signal
           return "unknown"
   ```
3. Cause determination uses heuristic mapping — signal combinations map to probable causes

**Files**:
- `joyus_profile/monitor/diagnosis.py` (new, ~120 lines)

**Validation**:
- [ ] Diagnosis identifies correct affected features from signals
- [ ] Cause determination: marker_shift alone → vocabulary_shift
- [ ] Cause determination: negative_increase → position_change
- [ ] Cause determination: stylometric + marker → corpus_evolution
- [ ] Cause determination: inconsistency alone → model_update
- [ ] Severity aggregated correctly from multiple signals

---

## Subtask T064: Feature-Level Attribution

**Purpose**: Identify which specific features drifted and by how much.

**Steps**:
1. Add `_identify_affected_features()` to `DiagnosisEngine`:
   ```python
   def _identify_affected_features(
       self, profile_id: str, signals: list[DriftSignal]
   ) -> list[DriftedFeature]:
       """Break drift signals into specific feature-level changes."""
       features = []

       for signal in signals:
           if signal.signal_type == "fidelity_decline":
               features.append(DriftedFeature(
                   feature_name="overall.fidelity_score",
                   description=f"Fidelity score declined from {signal.baseline_value:.2f} to {signal.current_value:.2f}",
                   baseline_value=signal.baseline_value,
                   current_value=signal.current_value,
                   deviation_pct=abs(signal.deviation),
               ))
           elif signal.signal_type == "marker_shift":
               features.append(DriftedFeature(
                   feature_name="vocabulary.signature_phrases",
                   description=f"Marker usage dropped {abs(signal.deviation)*100:.0f}%",
                   baseline_value=signal.baseline_value,
                   current_value=signal.current_value,
                   deviation_pct=abs(signal.deviation),
               ))
           elif signal.signal_type == "stylometric_distance":
               features.append(DriftedFeature(
                   feature_name="stylometrics.burrows_delta",
                   description=f"Stylometric distance increased to {signal.current_value:.3f} (baseline std: {signal.baseline_value:.3f})",
                   baseline_value=signal.baseline_value,
                   current_value=signal.current_value,
                   deviation_pct=abs(signal.deviation),
               ))
           elif signal.signal_type == "negative_increase":
               features.append(DriftedFeature(
                   feature_name="anti_patterns.prohibited_framings",
                   description="Prohibited framings detected in generated content",
                   baseline_value=0.0,
                   current_value=signal.current_value,
                   deviation_pct=100.0,  # Any increase from zero is 100% deviation
               ))
           elif signal.signal_type == "inconsistency":
               features.append(DriftedFeature(
                   feature_name="consistency.cross_document_variance",
                   description=f"Output variance {signal.current_value:.3f} exceeds {signal.baseline_value:.3f} historical",
                   baseline_value=signal.baseline_value,
                   current_value=signal.current_value,
                   deviation_pct=abs(signal.deviation),
               ))

       return features
   ```
2. Each `DriftedFeature` includes:
   - `feature_name`: dotted path (e.g., "vocabulary.signature_phrases")
   - `description`: human-readable explanation
   - `baseline_value`, `current_value`, `deviation_pct`

**Files**:
- `joyus_profile/monitor/diagnosis.py` (updated, +40 lines)

**Validation**:
- [ ] Each signal type maps to a specific feature name
- [ ] Descriptions are human-readable
- [ ] Deviation percentages calculated correctly

---

## Subtask T065: Human-Readable Diagnostic Reports

**Purpose**: Generate diagnostic reports that humans can understand and act on.

**Steps**:
1. Create `joyus_profile/monitor/reports.py`:
   ```python
   class DiagnosticReporter:
       def format_diagnosis(self, diagnosis: DriftDiagnosis) -> str:
           """Generate a human-readable diagnostic report."""
           lines = [
               f"# Drift Diagnosis: {diagnosis.profile_id}",
               f"**Date**: {diagnosis.detection_date.strftime('%Y-%m-%d %H:%M UTC')}",
               f"**Severity**: {diagnosis.severity.upper()}",
               f"**Probable cause**: {self._format_cause(diagnosis.probable_cause)}",
               "",
               "## Signals Detected",
               "",
           ]

           for signal in diagnosis.signals:
               lines.append(f"- **{signal.signal_type}** ({signal.severity}): "
                           f"current={signal.current_value:.3f}, "
                           f"baseline={signal.baseline_value:.3f}")

           lines.extend([
               "",
               "## Affected Features",
               "",
           ])

           for feature in diagnosis.affected_features:
               lines.append(f"- **{feature.feature_name}**: {feature.description}")

           lines.extend([
               "",
               "## Recommended Action",
               "",
               f"**Type**: {diagnosis.recommended_action.action_type}",
               f"**Description**: {diagnosis.recommended_action.description}",
               f"**Automated**: {'Yes' if diagnosis.recommended_action.automated else 'No — requires human approval'}",
           ])

           return "\n".join(lines)

       def _format_cause(self, cause: str) -> str:
           """Human-friendly cause names."""
           return {
               "model_update": "AI model behavior change",
               "corpus_evolution": "Author's writing style has evolved",
               "position_change": "Organizational position change",
               "vocabulary_shift": "Domain terminology shift",
               "profile_staleness": "Profile needs refresh (built too long ago)",
               "unknown": "Unknown — requires human investigation",
           }.get(cause, cause)
   ```
2. Report includes: severity, signals, affected features, probable cause, recommended action
3. Output is Markdown for easy rendering in any context

**Files**:
- `joyus_profile/monitor/reports.py` (new, ~70 lines)

**Validation**:
- [ ] Report includes all diagnosis fields
- [ ] Cause names are human-friendly
- [ ] Markdown renders correctly
- [ ] Report is actionable (tells the reader what to do)

---

## Subtask T066: Repair Action Framework

**Purpose**: Implement the 6 repair action types with a propose → approve → apply lifecycle.

**Steps**:
1. Create `joyus_profile/monitor/repair.py`:
   ```python
   class RepairFramework:
       def __init__(self, data_dir: str):
           self.repairs_dir = Path(data_dir) / "repairs"
           self.repairs_dir.mkdir(parents=True, exist_ok=True)

       def propose(self, diagnosis: DriftDiagnosis) -> RepairAction:
           """Create a repair proposal based on diagnosis."""
           action_type = diagnosis.recommended_action.action_type

           action = RepairAction(
               action_id=cuid2(),
               action_type=action_type,
               description=self._describe_action(action_type, diagnosis),
               automated=action_type in ("recalibrate_thresholds",),
               status="proposed",
               proposed_at=datetime.now(UTC),
           )

           # Persist the proposal
           self._save_repair(action, diagnosis)
           return action

       def approve(self, action_id: str) -> RepairAction:
           """Mark a repair as approved (human approval step)."""
           action = self._load_repair(action_id)
           if action.status != "proposed":
               raise ValueError(f"Cannot approve action in '{action.status}' state")
           action.status = "approved"
           self._save_repair(action)
           return action

       def apply(self, action_id: str) -> RepairAction:
           """Apply the approved repair."""
           action = self._load_repair(action_id)
           if action.status != "approved" and not action.automated:
               raise ValueError("Non-automated repairs require approval before applying")

           # Dispatch to specific repair handler
           handler = self._get_handler(action.action_type)
           handler.execute(action)

           action.status = "applied"
           action.applied_at = datetime.now(UTC)
           self._save_repair(action)
           return action

       def reject(self, action_id: str, reason: str) -> RepairAction:
           """Reject a proposed repair."""
           action = self._load_repair(action_id)
           action.status = "rejected"
           self._save_repair(action)
           return action

       def _get_handler(self, action_type: str) -> RepairHandler:
           """Get the handler for a specific repair type."""
           handlers = {
               "rebuild_profile": RebuildProfileHandler(),
               "update_markers": UpdateMarkersHandler(),
               "recalibrate_thresholds": RecalibrateHandler(),
               "update_positions": UpdatePositionsHandler(),
               "update_corpus": UpdateCorpusHandler(),
               "escalate": EscalateHandler(),
           }
           return handlers[action_type]
   ```
2. Define `RepairHandler` protocol and 6 concrete handlers:
   ```python
   class RepairHandler(Protocol):
       def execute(self, action: RepairAction) -> None: ...
       def revert(self, action: RepairAction) -> None: ...

   class RebuildProfileHandler:
       """Re-run profile building on expanded corpus."""
       def execute(self, action): ...
       def revert(self, action): ...

   class UpdateMarkersHandler:
       """Add new markers, retire obsolete ones."""
       # ...

   class RecalibrateHandler:
       """Adjust Tier 1 thresholds against known-good samples."""
       # (Only automated repair type)

   class UpdatePositionsHandler:
       """Update positions in hierarchy. May cascade org → dept → person."""
       # ...

   class UpdateCorpusHandler:
       """Rebuild profile from updated corpus."""
       # ...

   class EscalateHandler:
       """Create escalation record for human investigation."""
       # ...
   ```
3. Each handler implements `execute()` and `revert()`
4. Repair proposals stored in `monitoring/repairs/{action_id}.json`

**Files**:
- `joyus_profile/monitor/repair.py` (new, ~150 lines)

**Validation**:
- [ ] Propose creates a repair with status "proposed"
- [ ] Approve transitions to "approved"
- [ ] Apply transitions to "applied" (only after approval for non-automated)
- [ ] Reject transitions to "rejected"
- [ ] Automated repair (recalibrate) can skip approval
- [ ] Non-automated repair raises error if applied without approval

---

## Subtask T067: Repair Verification

**Purpose**: Verify that a repair didn't break anything — regression, forward, and cross-profile checks.

**Steps**:
1. Create `joyus_profile/monitor/verify_repair.py`:
   ```python
   class RepairVerifier:
       def __init__(self, hierarchy_dir: str, score_store: ScoreStore):
           self.hierarchy_dir = hierarchy_dir
           self.score_store = score_store

       def verify(self, action: RepairAction, profile_id: str) -> RepairVerification:
           """Run all three verification checks after a repair."""
           regression = self._regression_test(profile_id)
           forward = self._forward_test(profile_id)
           cross_profile = self._cross_profile_check(profile_id)

           result = RepairVerification(
               regression_passed=regression,
               forward_passed=forward,
               cross_profile_passed=cross_profile,
               details=self._build_details(regression, forward, cross_profile),
           )

           # Update repair action status
           if result.regression_passed and result.forward_passed and result.cross_profile_passed:
               action.status = "verified"
               action.verified_at = datetime.now(UTC)
           else:
               # Verification failed — needs revert
               action.status = "applied"  # Keep as applied, revert is separate

           action.verification_result = result
           return result

       def _regression_test(self, profile_id: str) -> bool:
           """Run attribution accuracy suite — must not drop below baseline."""
           # Load known-good test samples
           # Run attribution
           # Check accuracy >= baseline (94.6% for 4-author, 97.9% for 9-author)

       def _forward_test(self, profile_id: str) -> bool:
           """Generate new content with updated profile, check fidelity >= threshold."""
           # Generate test content
           # Score with FidelityScorer
           # Check score >= 0.80 (person) or >= 0.75 (dept/org)

       def _cross_profile_check(self, profile_id: str) -> bool:
           """Verify other profiles weren't accidentally shifted."""
           # Pick 2-3 other profiles from hierarchy
           # Run attribution on their known text
           # Verify scores haven't degraded
   ```
2. All three checks must pass for the repair to be considered verified (spec §6.6)
3. If any fail → repair needs revert

**Files**:
- `joyus_profile/monitor/verify_repair.py` (new, ~80 lines)

**Validation**:
- [ ] Regression test catches accuracy drop
- [ ] Forward test catches poor fidelity
- [ ] Cross-profile check catches collateral damage
- [ ] All pass → status "verified"
- [ ] Any fail → status remains "applied" (revert needed)

---

## Subtask T068: Revert Mechanism

**Purpose**: Revert a failed repair to restore the previous profile state.

**Steps**:
1. Add revert support to `RepairFramework`:
   ```python
   def revert(self, action_id: str) -> RepairAction:
       """Revert an applied repair that failed verification."""
       action = self._load_repair(action_id)
       if action.status not in ("applied", "verified"):
           raise ValueError(f"Cannot revert action in '{action.status}' state")

       # Each handler knows how to revert
       handler = self._get_handler(action.action_type)
       handler.revert(action)

       action.status = "reverted"
       self._save_repair(action)
       return action
   ```
2. Backup strategy: Before applying any repair, snapshot the affected files:
   ```python
   def _snapshot_before_repair(self, action: RepairAction) -> None:
       """Save pre-repair state for revert capability."""
       snapshot_dir = self.repairs_dir / action.action_id / "snapshot"
       snapshot_dir.mkdir(parents=True, exist_ok=True)
       # Copy affected skill files, markers, profiles to snapshot
   ```
3. Revert restores from the snapshot
4. After revert, run verification again to confirm restoration

**Files**:
- `joyus_profile/monitor/repair.py` (updated, +40 lines)

**Validation**:
- [ ] Snapshot created before every apply()
- [ ] Revert restores previous state exactly
- [ ] Reverted action has status "reverted"
- [ ] Cannot revert a "proposed" or "rejected" action

---

## Definition of Done

- [ ] Diagnosis engine identifies affected features and probable cause
- [ ] All 6 repair types implemented with propose/approve/apply lifecycle
- [ ] Repair verification runs regression, forward, and cross-profile checks
- [ ] Revert mechanism restores pre-repair state
- [ ] Human-readable diagnostic reports generated
- [ ] All tests pass

## Risks

- **Cause determination accuracy**: Heuristic mapping from signals to causes may misdiagnose. Document known ambiguities and fallback to "unknown" when uncertain.
- **Repair handler completeness**: Full repair execution (e.g., rebuilding profiles) requires Phase A infrastructure. Handlers may need to be stubs initially, with TODOs for full implementation once integrated with the profile builder.
- **Cross-profile verification**: Checking all profiles after every repair can be slow for large hierarchies. Consider sampling strategy.

## Activity Log

- 2026-02-20T13:48:41Z – unknown – lane=doing – Implementation started by claude-lead
- 2026-02-20T13:58:05Z – unknown – lane=for_review – 162 tests passing, all subtasks done
- 2026-02-20T14:00:56Z – unknown – lane=done – Review passed: 162 tests, rejection_reason persisted, deterministic sibling ordering
