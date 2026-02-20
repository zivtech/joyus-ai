---
work_package_id: WP09
title: Hierarchy Management + Emission
lane: "doing"
dependencies: [WP08]
base_branch: 005-content-intelligence-WP08
base_commit: 05ec16b4eb97098515b802820dea12cce9d9863d
created_at: '2026-02-20T10:48:35.964207+00:00'
subtasks: [T043, T044, T045, T046]
shell_pid: "71035"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP09: Hierarchy Management + Emission

## Objective

CRUD operations for the full profile hierarchy, cascade propagation of org-level changes, profile diffing, and multi-level skill file emission.

## Implementation Command

```bash
spec-kitty implement WP09 --base WP08
```

## Context

- **Plan**: plan.md §B.2
- **Spec**: spec.md §8.2 (Skill File Structure Per Profile)
- **API Contract**: contracts/profile-engine-api.md §Composite (HierarchyManager)

---

## Subtask T043: HierarchyManager CRUD

**Purpose**: Manage the full profile hierarchy with add/remove/rebuild operations.

**Steps**:
1. Create `joyus_profile/profile/hierarchy.py`
2. Implement `HierarchyManager`:
   ```python
   class HierarchyManager:
       def build(self, people, departments_config, org_config) -> ProfileHierarchy:
           # Full hierarchy construction from scratch
           builder = CompositeBuilder()
           depts = {}
           for dept_id, config in departments_config.items():
               members = [p for p in people if p.profile_id in config["members"]]
               depts[dept_id] = builder.build_department(members, config["name"], config["domain"])
           org = builder.build_organization(list(depts.values()), **org_config)
           return ProfileHierarchy(org_profile=org, departments=depts, people={p.profile_id: p for p in people}, ...)

       def add_person(self, hierarchy, profile, dept_ids) -> ProfileHierarchy:
           # Add person to hierarchy, update affected department composites

       def remove_person(self, hierarchy, person_id) -> ProfileHierarchy:
           # Remove person, rebuild affected departments

       def rebuild_composites(self, hierarchy) -> ProfileHierarchy:
           # Full rebuild of all department and org composites from current people

       def diff(self, old, new) -> HierarchyDiff:
           # Compare two hierarchy versions
   ```

**Files**:
- `joyus_profile/profile/hierarchy.py` (new, ~150 lines)

**Validation**:
- [ ] `build()` creates complete hierarchy from people + config
- [ ] `add_person()` updates affected department composites
- [ ] `remove_person()` rebuilds without the removed person
- [ ] `rebuild_composites()` produces same result as fresh `build()`

---

## Subtask T044: Cascade Org-Level Changes

**Purpose**: Propagate organizational changes down through the hierarchy.

**Steps**:
1. Add cascade methods to `HierarchyManager`:
   ```python
   def update_prohibited_framings(self, hierarchy, framings) -> ProfileHierarchy:
       # Update org, cascade to ALL departments and people
       hierarchy.org_profile.prohibited_framings = framings
       for dept in hierarchy.departments.values():
           dept.prohibited_framings = framings  # Cascade
       for person in hierarchy.people.values():
           person.anti_patterns.prohibited_framings = framings
       return hierarchy

   def update_official_position(self, hierarchy, position) -> ProfileHierarchy:
       # If authoritative: override individual positions on the same topic
       if position.authoritative:
           for person in hierarchy.people.values():
               self._override_position(person, position)
       return hierarchy
   ```
2. Ensure cascading is idempotent (applying the same change twice produces same result)
3. Log what changed at each level for auditability

**Files**:
- `joyus_profile/profile/hierarchy.py` (updated, +60 lines)

**Validation**:
- [ ] Prohibited framings appear in all levels after cascade
- [ ] Authoritative positions override individual stances
- [ ] Cascade is idempotent

---

## Subtask T045: Profile Diffing

**Purpose**: Compare two versions of a profile or hierarchy and report changes.

**Steps**:
1. Define `HierarchyDiff` model:
   ```python
   class HierarchyDiff(BaseModel):
       added_people: list[str] = []
       removed_people: list[str] = []
       modified_people: list[ProfileDiff] = []
       added_departments: list[str] = []
       removed_departments: list[str] = []
       modified_departments: list[ProfileDiff] = []
       org_changes: ProfileDiff | None = None

   class ProfileDiff(BaseModel):
       profile_id: str
       changed_sections: list[str]  # Which sections changed
       summary: str  # Human-readable summary
   ```
2. Implement `diff()` method: compare corresponding profiles field by field
3. For stylometric baselines: flag if delta exceeds threshold (meaningful change vs noise)

**Files**:
- `joyus_profile/profile/hierarchy.py` (updated, +50 lines)
- `joyus_profile/models/hierarchy.py` (updated with HierarchyDiff, ProfileDiff)

---

## Subtask T046: Skill File Emission for Full Hierarchy

**Purpose**: Emit skill files at all three levels (org, departments, people).

**Steps**:
1. Add to `SkillEmitter`:
   ```python
   def emit_hierarchy(self, hierarchy: ProfileHierarchy, output_dir: str) -> dict[str, SkillFileSet]:
       results = {}

       # Org level
       results["org"] = self.emit(hierarchy.org_profile, f"{output_dir}/org/")

       # Department level
       for dept_id, dept in hierarchy.departments.items():
           slug = self._slugify(dept.name)
           results[dept_id] = self.emit(dept, f"{output_dir}/departments/{slug}/")

       # People level
       for person_id, person in hierarchy.people.items():
           slug = self._slugify(person.author_name)
           results[person_id] = self.emit(person, f"{output_dir}/people/{slug}/")

       return results
   ```
2. Output structure matches spec.md §8.2:
   ```
   skills/
   ├── org/SKILL.md, markers.json, stylometrics.json, voices.json
   ├── departments/credit-reporting/SKILL.md, ...
   └── people/author-001/SKILL.md, ..., voices/litigator.json, ...
   ```
3. Generate `voices.json` at org level with the voice catalog

**Files**:
- `joyus_profile/emit/skill_emitter.py` (updated, +50 lines)

**Validation**:
- [ ] `emit_hierarchy()` creates correct directory structure
- [ ] Each level has SKILL.md + markers.json + stylometrics.json
- [ ] Org level includes voices.json
- [ ] People with voice_contexts have voices/ subdirectory

---

## Definition of Done

- [ ] Full hierarchy CRUD operations work (build, add, remove, rebuild)
- [ ] Org-level changes cascade correctly
- [ ] `diff()` produces meaningful change reports
- [ ] `emit_hierarchy()` creates correct multi-level directory structure
- [ ] All tests pass

## Risks

- **Cascade performance**: Rebuilding all department composites when one person changes could be slow for large orgs. Consider incremental update formula from research.md.
