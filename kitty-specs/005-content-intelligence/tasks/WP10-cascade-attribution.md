---
work_package_id: WP10
title: Cascade Attribution
lane: "for_review"
dependencies: [WP09]
base_branch: 005-content-intelligence-WP08
base_commit: 05ec16b4eb97098515b802820dea12cce9d9863d
created_at: '2026-02-20T10:48:38.882528+00:00'
subtasks: [T047, T048, T049, T050]
shell_pid: "71842"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP10: Cascade Attribution

## Objective

Multi-level attribution engine: person → department → organization → outsider cascade with ranked candidate lists and MCP tool exposure.

## Implementation Command

```bash
spec-kitty implement WP10 --base WP09
```

## Context

- **Plan**: plan.md §B.3
- **Spec**: spec.md §4 (System 1: Attribution & Validation Engine)
- **Data Model**: data-model.md §Attribution Entities
- **API Contract**: contracts/mcp-tools-api.md §Attribution Tools

---

## Subtask T047: Cascade Attribution Engine

**Purpose**: Implement the multi-level attribution cascade from spec.md §4.3.

**Steps**:
1. Create `joyus_profile/attribute/cascade.py`
2. Implement `AttributionEngine`:
   ```python
   class AttributionEngine:
       def __init__(self, hierarchy: ProfileHierarchy):
           self.hierarchy = hierarchy

       def identify(self, text: str) -> AttributionResult:
           """Full cascade: person → dept → org → outsider."""

           # Level 1: Check all person profiles
           person_candidates = self._score_all_people(text)
           if person_candidates and person_candidates[0].score > 0.85:
               return AttributionResult(
                   match_level="person",
                   candidates=person_candidates,
                   confidence=person_candidates[0].score,
               )

           # Level 2: Check department profiles
           dept_candidates = self._score_all_departments(text)
           if dept_candidates and dept_candidates[0].score > 0.80:
               return AttributionResult(match_level="department", ...)

           # Level 3: Check org profile
           org_score = self._score_organization(text)
           if org_score > 0.70:
               return AttributionResult(match_level="organization", ...)

           # Level 4: No match → outsider
           return AttributionResult(match_level="outsider", ...)

       def verify_author(self, text: str, person_id: str) -> AttributionResult:
           """Verify text against a specific known author."""

       def validate_department(self, text: str, dept_id: str) -> AttributionResult:
           """Validate text against a specific department."""

       def validate_organization(self, text: str) -> AttributionResult:
           """Validate text against org profile only."""
   ```
3. Scoring uses FidelityScorer from WP05 (Tier 1 for speed, Tier 2 for accuracy)
4. Return ranked `CandidateMatch` list sorted by score descending
5. Include matched_markers in each candidate for explainability

**Files**:
- `joyus_profile/attribute/cascade.py` (new, ~150 lines)

**Validation**:
- [ ] Person-level match at >0.85 returns person match
- [ ] Fallback to department at >0.80 when no person match
- [ ] Fallback to org at >0.70 when no department match
- [ ] Outsider flagged when no match at any level
- [ ] Candidates ranked by score

---

## Subtask T048: Author Identifier

**Purpose**: Identify unknown authors without a target — return ranked candidate list.

**Steps**:
1. Create `joyus_profile/attribute/identifier.py`
2. Implement author identification:
   ```python
   class AuthorIdentifier:
       def identify(self, text: str, hierarchy: ProfileHierarchy,
                    explanation_tier: str = "pattern") -> AttributionResult:
           # Score against ALL profiles (all levels)
           candidates = []
           for person_id, profile in hierarchy.people.items():
               score = self._score_text(text, profile)
               markers = self._matched_markers(text, profile)
               candidates.append(CandidateMatch(
                   profile_id=person_id,
                   profile_type="person",
                   score=score,
                   matched_markers=markers,
               ))
           # Sort and return top candidates
           candidates.sort(key=lambda c: c.score, reverse=True)
           return AttributionResult(candidates=candidates[:10], ...)
   ```
3. Explanation tiers (spec.md §4.4):
   - `pattern`: marker matches, stylometric scores (safe for any user)
   - `passage`: source text comparisons (requires content access)

**Files**:
- `joyus_profile/attribute/identifier.py` (new, ~80 lines)

---

## Subtask T049: Outsider Detection

**Purpose**: Detect text from outside the organization.

**Steps**:
1. Create `joyus_profile/attribute/outsider.py`
2. Implement:
   ```python
   class OutsiderDetector:
       def detect(self, text: str, hierarchy: ProfileHierarchy) -> AttributionResult:
           # Run full cascade
           cascade = AttributionEngine(hierarchy).identify(text)

           # If cascade returned "outsider" match_level
           is_outsider = cascade.match_level == "outsider"

           # Also check: if best match is below threshold
           best_score = cascade.candidates[0].score if cascade.candidates else 0.0
           confidence = 1.0 - best_score  # High confidence of outsider when best match is low

           return AttributionResult(
               match_level="outsider" if is_outsider else cascade.match_level,
               confidence=confidence if is_outsider else best_score,
               explanation=f"{'Does not' if is_outsider else 'Does'} match organizational voice.",
               candidates=cascade.candidates[:3],  # Show closest matches for context
           )
   ```

**Files**:
- `joyus_profile/attribute/outsider.py` (new, ~50 lines)

---

## Subtask T050: Attribution MCP Tools

**Purpose**: Expose attribution as MCP tools.

**Steps**:
1. Create `joyus_profile/mcp_server/tools/attribute_tools.py`
2. Register 3 tools (reference: contracts/mcp-tools-api.md §Attribution Tools):
   - `identify_author`: text, hierarchy_dir, explanation_tier → match_level, candidates, explanation
   - `validate_attribution`: text, target_id, target_type, hierarchy_dir → matched, confidence, explanation, feature_breakdown
   - `detect_outsider`: text, hierarchy_dir → is_outsider, confidence, closest_match, explanation
3. Load hierarchy from skill files directory structure
4. Wrap in `asyncio.to_thread()` for sync calls

**Files**:
- `joyus_profile/mcp_server/tools/attribute_tools.py` (new, ~100 lines)

**Validation**:
- [ ] All 3 attribution tools callable via MCP
- [ ] `identify_author` returns ranked candidates
- [ ] `detect_outsider` correctly flags external text

---

## Definition of Done

- [ ] Cascade attribution works at all 4 levels (person, dept, org, outsider)
- [ ] Threshold-based level selection matches spec (0.85, 0.80, 0.70)
- [ ] MCP tools expose all attribution modes
- [ ] Explanation tiers respect access control boundaries
- [ ] All tests pass

## Risks

- **Scoring speed**: Checking against ALL profiles may be slow for 30+ authors. Consider pre-filtering by marker overlap before running full stylometric comparison.
- **Threshold tuning**: 0.85/0.80/0.70 thresholds are from the spec — may need empirical calibration.

## Activity Log

- 2026-02-20T10:58:53Z – unknown – shell_pid=71842 – lane=for_review – Ready for review: Cascade attribution (person/dept/org/outsider), AuthorIdentifier, OutsiderDetector, MCP tool handlers. 32 tests.
