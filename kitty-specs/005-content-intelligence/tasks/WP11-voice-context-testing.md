---
work_package_id: WP11
title: Voice Context + Phase B Testing
lane: "doing"
dependencies: [WP10]
base_branch: 005-content-intelligence-WP10
base_commit: a381b339987c84d6d8db7030c73c3bde1fc016de
created_at: '2026-02-20T11:25:07.586470+00:00'
subtasks: [T051, T052, T053, T054, T055, T056]
shell_pid: "74448"
agent: "claude-lead"
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP11: Voice Context + Phase B Testing

## Objective

Implement VoiceContext resolution (3-layer opt-in), access control checking, and comprehensive Phase B integration testing including full hierarchy build and attribution accuracy verification.

## Implementation Command

```bash
spec-kitty implement WP11 --base WP10
```

## Context

- **Plan**: plan.md §B.4, §B.5
- **Spec**: spec.md §5.3 (Generation Workflow — voice resolution), §7.2 Principle 8 (voice-level access)
- **Profile Engine Spec**: profile-engine-spec.md §3.1 (VoiceContext architecture)
- **Data Model**: data-model.md §VoiceContext, §VoiceAccessLevel

**VoiceContext 3-layer opt-in**:
- Layer 0: Single voice (no voice_contexts, base profile only)
- Layer 1: Multi-audience (voice_contexts populated, no access restrictions)
- Layer 2: Restricted voices (VoiceAccessLevel gating on some voices)

---

## Subtask T051: VoiceResolver.resolve()

**Purpose**: Resolve a profile + audience key into a merged profile with voice overrides applied.

**Steps**:
1. Create `joyus_profile/voice/resolver.py`
2. Implement `VoiceResolver`:
   ```python
   class VoiceResolver:
       def resolve(
           self,
           profile: AuthorProfile,
           audience_key: str | None = None,
           hierarchy: ProfileHierarchy | None = None,
       ) -> ResolvedProfile:
           # Layer 0: No audience_key → return base profile as-is
           if audience_key is None:
               return ResolvedProfile(profile=profile, voice_key=None, tier=profile.fidelity_tier)

           # Layer 1: Look up voice_contexts
           if audience_key not in profile.voice_contexts:
               raise ValueError(f"Voice '{audience_key}' not found in profile")

           vc = profile.voice_contexts[audience_key]

           # Apply section overrides
           resolved = profile.model_copy(deep=True)
           if vc.voice_override:
               resolved.voice = vc.voice_override
           if vc.vocabulary_override:
               resolved.vocabulary = self._merge_vocabulary(profile.vocabulary, vc.vocabulary_override)
           if vc.argumentation_override:
               resolved.argumentation = vc.argumentation_override
           if vc.citations_override:
               resolved.citations = vc.citations_override
           if vc.structure_override:
               resolved.structure = vc.structure_override
           if vc.positions_override:
               resolved.positions = vc.positions_override
           if vc.examples_override:
               resolved.examples = vc.examples_override
           if vc.anti_patterns_override:
               resolved.anti_patterns = self._merge_anti_patterns(
                   profile.anti_patterns, vc.anti_patterns_override)

           # Merge prohibited framings from hierarchy (org level)
           if hierarchy:
               resolved = self._apply_org_overrides(resolved, hierarchy)

           return ResolvedProfile(
               profile=resolved,
               voice_key=audience_key,
               tier=vc.fidelity_tier or profile.fidelity_tier,
           )

       def _merge_vocabulary(self, base, override):
           """Merge vocabulary: override adds terms, doesn't remove base terms."""

       def _merge_anti_patterns(self, base, override):
           """Merge anti-patterns: union of both (more restrictive)."""

       def _apply_org_overrides(self, profile, hierarchy):
           """Apply org-level prohibited framings and authoritative positions."""
   ```
3. Define `ResolvedProfile` model: contains the merged profile + metadata

**Files**:
- `joyus_profile/voice/resolver.py` (new, ~120 lines)

**Validation**:
- [ ] Layer 0: no audience_key → base profile returned unchanged
- [ ] Layer 1: voice overrides applied to correct sections
- [ ] Vocabulary merges (union, not replacement)
- [ ] Anti-patterns merge (union — more restrictive)
- [ ] Org prohibited framings always applied

---

## Subtask T052: AccessChecker

**Purpose**: Check whether a requesting user has access to a specific voice profile.

**Steps**:
1. Create `joyus_profile/voice/access.py`
2. Implement `AccessChecker`:
   ```python
   class AccessChecker:
       def can_access_voice(
           self,
           profile: AuthorProfile,
           voice_key: str,
           user_access_level: ContentAccessLevel,
       ) -> bool:
           if voice_key not in profile.voice_contexts:
               return False

           vc = profile.voice_contexts[voice_key]

           # No access_level set → unrestricted (Layer 1)
           if vc.access_level is None:
               return True

           # Layer 2: Check user level against voice level
           level_order = {
               ContentAccessLevel.PUBLIC: 0,
               ContentAccessLevel.SUBSCRIBER: 1,
               ContentAccessLevel.GROUP: 2,
               ContentAccessLevel.INTERNAL: 3,
           }
           return level_order[user_access_level] >= level_order[vc.access_level.level]
   ```
3. When access is denied, return a sanitized profile (statistical patterns only, no restricted content)

**Files**:
- `joyus_profile/voice/access.py` (new, ~50 lines)

**Validation**:
- [ ] PUBLIC user can access PUBLIC voices
- [ ] PUBLIC user denied access to SUBSCRIBER voices
- [ ] INTERNAL user can access all voices
- [ ] Unrestricted voices (no access_level) accessible by anyone

---

## Subtask T053: Layer 0/1/2 Tests

**Purpose**: Verify all three voice layers work correctly.

**Steps**:
1. Create `tests/unit/test_voice/test_resolver.py`:
   - Layer 0: Profile with empty voice_contexts → base profile
   - Layer 1: Profile with 3 voices (advocate, educator, expert) → correct overrides applied
   - Layer 2: Profile with restricted voice (SUBSCRIBER required) → access check enforced
2. Test edge cases:
   - Request non-existent voice → error
   - Voice with partial overrides (only voice_override, no vocabulary_override) → other sections unchanged
   - Org-level prohibited framings present in resolved profile

**Files**:
- `tests/unit/test_voice/test_resolver.py` (new, ~100 lines)
- `tests/unit/test_voice/test_access.py` (new, ~50 lines)

---

## Subtask T054: Unit Tests for Composites, Inheritance, Cascade

**Purpose**: Unit-level validation of Phase B components.

**Steps**:
1. Create `tests/unit/test_profile/test_composite.py`:
   - `build_department()` with 3 members → valid department profile
   - `build_organization()` with 2 departments → valid org profile
   - Weighted mean produces correct feature values
2. Create `tests/unit/test_profile/test_hierarchy.py`:
   - `add_person()` updates composites
   - `remove_person()` rebuilds correctly
   - Cascade of prohibited framings works
3. Create `tests/unit/test_attribute/test_cascade.py`:
   - Person-level match at >0.85
   - Department fallback at >0.80
   - Outsider detection for unmatched text

**Files**:
- `tests/unit/test_profile/test_composite.py` (new, ~80 lines)
- `tests/unit/test_profile/test_hierarchy.py` (new, ~80 lines)
- `tests/unit/test_attribute/test_cascade.py` (new, ~60 lines)

---

## Subtask T055: Integration — Full Hierarchy + Attribution Cascade

**Purpose**: Build a realistic hierarchy and test the full attribution cascade.

**Steps**:
1. Create `tests/integration/test_hierarchy_cascade.py`
2. Build a test hierarchy:
   - 1 org with 2 departments and 5 people
   - Each person has 5 documents in fixtures
   - Emit skill files for all levels
3. Run attribution cascade:
   - Known-person text → person match
   - Department-style text (shared vocabulary, no person match) → department match
   - Org-style text (editorial) → org match
   - External text (different style) → outsider

**Files**:
- `tests/integration/test_hierarchy_cascade.py` (new, ~100 lines)

---

## Subtask T056: Accuracy Tests

**Purpose**: Verify attribution accuracy at all levels meets spec targets.

**Steps**:
1. Create `tests/regression/test_hierarchy_accuracy.py`
2. Targets (spec.md §10):
   - Department-level: >=90%
   - Organization-level: >=85%
   - Outsider detection: >=95%
3. Cross-validated: build hierarchy from 80% of data, test on 20%

**Files**:
- `tests/regression/test_hierarchy_accuracy.py` (new, ~60 lines)

---

## Definition of Done

- [ ] VoiceResolver handles Layers 0, 1, and 2 correctly
- [ ] AccessChecker enforces voice-level access control
- [ ] All Phase B unit tests pass
- [ ] Full hierarchy integration test passes
- [ ] Attribution accuracy: dept >=90%, org >=85%, outsider >=95%

## Risks

- **Accuracy on fixture data**: Anonymized fixtures may not reach accuracy targets. Document known limitations.
- **Voice resolution complexity**: Merging overrides from multiple levels (person + dept + org) requires careful precedence logic.

## Activity Log

- 2026-02-20T13:35:40Z – unknown – shell_pid=94608 – lane=for_review – Ready for review: VoiceResolver, AccessChecker, 143 tests passing, ruff clean
- 2026-02-20T13:35:59Z – claude-lead – shell_pid=74448 – lane=doing – Started review via workflow command
