---
work_package_id: WP08
title: Composite Profile Builder
lane: "doing"
dependencies: [WP04]
base_branch: 005-content-intelligence-WP04
base_commit: 26db9dfd4b0edfa5473ed0dd6668f097545e847a
created_at: '2026-02-20T10:39:27.480499+00:00'
subtasks: [T039, T040, T041, T042]
shell_pid: "14469"
agent: "claude-opus"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP08: Composite Profile Builder

## Objective

Build department-level and organization-level composite profiles from member profiles using corpus-size weighted mean aggregation.

## Implementation Command

```bash
spec-kitty implement WP08 --base WP04
```

## Context

- **Plan**: plan.md §B.1
- **Spec**: spec.md §3.2 (Composite Profile Construction)
- **Research**: research.md §R4 (weighted mean recommended, incremental update formula)
- **Data Model**: data-model.md §Hierarchy Entities
- **API Contract**: contracts/profile-engine-api.md §Composite

**Key research findings**:
- Corpus-size weighted mean is the default algorithm
- Incremental update: `new = (old * old_total + new_vec * new_size) / (old_total + new_size)`
- Use `intersection_masked` only for strict voice enforcement
- Cosine similarity (not Euclidean) for profile comparison

**Note**: WP08 can run in **parallel with WP05-WP07** since it depends only on WP04.

---

## Subtask T039: CompositeBuilder.build_department()

**Purpose**: Aggregate person-level profiles into a department composite using weighted mean.

**Steps**:
1. Create `joyus_profile/profile/composite.py`
2. Implement `CompositeBuilder`:
   ```python
   class CompositeBuilder:
       def build_department(
           self,
           member_profiles: list[AuthorProfile],
           department_name: str,
           domain_specialization: str,
       ) -> DepartmentProfile:
           # 1. Validate: need >= 2 members
           if len(member_profiles) < 2:
               raise ProfileBuildError("Department needs >= 2 members")

           # 2. Compute shared vocabulary (intersection across members)
           shared_vocab = self._intersect_vocabularies(member_profiles)

           # 3. Compute shared positions (consensus stances)
           shared_positions = self._aggregate_positions(member_profiles)

           # 4. Compute structural range (union of patterns)
           structural_range = self._union_structures(member_profiles)

           # 5. Build stylometric baseline (weighted mean)
           baseline = self._weighted_mean_features(member_profiles)

           # 6. Merge audience registers
           registers = self._merge_registers(member_profiles)

           return DepartmentProfile(
               department_id=cuid2(),
               name=department_name,
               domain_specialization=domain_specialization,
               member_ids=[p.profile_id for p in member_profiles],
               shared_vocabulary=shared_vocab,
               shared_positions=shared_positions,
               structural_range=structural_range,
               stylometric_baseline=baseline,
               audience_registers=registers,
           )
   ```
3. Implement `_weighted_mean_features()`:
   ```python
   def _weighted_mean_features(self, profiles: list[AuthorProfile]) -> StylometricBaseline:
       total_words = sum(p.word_count for p in profiles)
       weights = {p.profile_id: p.word_count / total_words for p in profiles}
       # Apply weighted mean to each stylometric feature vector
       # (function word frequencies, sentence length stats, etc.)
   ```

**Files**:
- `joyus_profile/profile/composite.py` (new, ~150 lines)

**Validation**:
- [ ] Department profile reflects shared vocabulary of members
- [ ] Stylometric baseline weighted by corpus size
- [ ] Raises error for <2 members

---

## Subtask T040: CompositeBuilder.build_organization()

**Purpose**: Aggregate department profiles into an organization composite with editorial layer.

**Steps**:
1. Add to `composite.py`:
   ```python
   def build_organization(
       self,
       department_profiles: list[DepartmentProfile],
       org_name: str,
       editorial_style_guide: StyleGuide | None = None,
       official_positions: list[OfficialPosition] | None = None,
       prohibited_framings: list[ProhibitedFraming] | None = None,
       voice_definitions: dict[str, VoiceDefinition] | None = None,
   ) -> OrganizationProfile:
       # 1. Cross-department vocabulary consistency
       # 2. Aggregate stylometric baseline
       # 3. Apply editorial layer (style guide, positions, prohibitions)
       # 4. Register voice definitions (audience catalog)
   ```
2. Editorial layer overrides:
   - `official_positions` marked `authoritative: true` override individual positions
   - `prohibited_framings` cascade to all departments and people (cannot be overridden)
   - `editorial_style_guide` establishes org-wide voice defaults
3. Voice catalog: `voice_definitions` declares available audience voices (spec.md §3.3)

**Files**:
- `joyus_profile/profile/composite.py` (updated, +80 lines)

**Validation**:
- [ ] Org profile includes editorial style guide
- [ ] Prohibited framings cascade to all levels
- [ ] Voice definitions stored in org profile

---

## Subtask T041: Hierarchy Pydantic Models

**Purpose**: Define DepartmentProfile, OrganizationProfile, ProfileHierarchy, and VoiceDefinition.

**Steps**:
1. Create `joyus_profile/models/hierarchy.py`
2. Define models (reference: data-model.md §Hierarchy Entities):
   - `DepartmentProfile`: department_id, name, domain_specialization, member_ids, shared_vocabulary, shared_positions, structural_range, audience_registers, stylometric_baseline, typical_document_types
   - `OrganizationProfile`: org_id, name, editorial_style_guide, official_positions, prohibited_framings, department_overrides, voice_definitions, stylometric_baseline
   - `ProfileHierarchy`: hierarchy_id, org_profile, departments (dict), people (dict), department_members (dict), person_departments (dict), version, built_at
   - `VoiceDefinition`: audience_key, audience_label, description, target_audience, access_level
   - Supporting types: `StyleGuide`, `OfficialPosition`, `ProhibitedFraming`, `OverrideSet`, `StylometricBaseline`
3. Export from `models/__init__.py`

**Files**:
- `joyus_profile/models/hierarchy.py` (new, ~120 lines)

**Validation**:
- [ ] ProfileHierarchy validates with org + departments + people
- [ ] Many-to-many relationship: person_departments maps correctly

---

## Subtask T042: Topic-Based Department Model

**Purpose**: Support people belonging to multiple expertise areas (topic-based, not org-chart).

**Steps**:
1. Ensure `AuthorProfile.department_ids` is `list[str]` (multiple departments)
2. In `ProfileHierarchy`:
   - `department_members: dict[str, list[str]]` — dept_id → [person_ids]
   - `person_departments: dict[str, list[str]]` — person_id → [dept_ids]
3. When building a department profile, a person's features contribute to ALL their departments (weighted by the proportion of their corpus relevant to that topic)
4. Add validation: every person must belong to at least one department

**Files**:
- `joyus_profile/profile/composite.py` (updated, +20 lines)
- `joyus_profile/models/hierarchy.py` (updated, validation rules)

**Validation**:
- [ ] Person can belong to 2+ departments
- [ ] Person's features contribute to each department's composite
- [ ] Hierarchy validation catches orphaned people (no department)

---

## Definition of Done

- [ ] `CompositeBuilder().build_department(profiles, ...)` produces valid DepartmentProfile
- [ ] `CompositeBuilder().build_organization(depts, ...)` produces valid OrganizationProfile
- [ ] Topic-based departments support many-to-many person↔department relationships
- [ ] Prohibited framings cascade from org to all levels
- [ ] All hierarchy models validate correctly

## Risks

- **Weighted mean calibration**: Synthetic test data may not reflect real-world department dynamics. Use diverse fixture data.
- **Topic-based weighting**: Proportional contribution per department requires corpus annotation (which docs belong to which topic). May need manual tagging initially.

## Activity Log

- 2026-02-20T10:45:53Z – unknown – shell_pid=49638 – lane=for_review – Ready for review: CompositeBuilder with department/org aggregation, hierarchy validation, incremental updates, 27 tests passing
- 2026-02-20T10:59:41Z – claude-opus – shell_pid=14469 – lane=doing – Started review via workflow command
