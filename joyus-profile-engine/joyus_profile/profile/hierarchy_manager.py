"""Hierarchy management: CRUD, cascade operations, and diffing for ProfileHierarchy."""

from __future__ import annotations

import re

from cuid2 import cuid_wrapper

from joyus_profile.exceptions import HierarchyValidationError, ProfileBuildError
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    HierarchyDiff,
    OfficialPosition,
    OrganizationProfile,
    ProfileDiff,
    ProfileHierarchy,
    ProhibitedFraming,
    StylometricBaseline,
)
from joyus_profile.models.profile import AuthorProfile
from joyus_profile.profile.composite import CompositeBuilder

_cuid = cuid_wrapper()


def _slugify(name: str) -> str:
    """Convert a name to a URL-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unnamed"


class HierarchyManager:
    """CRUD operations, cascade updates, and diffing for ProfileHierarchy.

    All mutating methods return a new ProfileHierarchy (immutable update pattern).
    Uses CompositeBuilder for all composite construction.
    """

    def __init__(self) -> None:
        self._builder = CompositeBuilder()

    # ── Build ──────────────────────────────────────────────────────────

    def build(
        self,
        people: list[AuthorProfile],
        departments_config: list[dict],
        org_config: dict,
    ) -> ProfileHierarchy:
        """Construct a complete hierarchy from people and config dicts.

        departments_config: list of dicts with keys:
            - name (str, required)
            - domain_specialization (str, default "general")
            - member_ids (list[str]) — profile_ids of members

        org_config: dict with keys:
            - name (str, required)
            - editorial_style_guide (StyleGuide | None)
            - official_positions (list[OfficialPosition])
            - prohibited_framings (list[ProhibitedFraming])
            - voice_definitions (dict[str, VoiceDefinition])
        """
        people_map: dict[str, AuthorProfile] = {p.profile_id: p for p in people}

        departments: dict[str, DepartmentProfile] = {}
        department_members: dict[str, list[str]] = {}
        person_departments: dict[str, list[str]] = {}

        for dept_cfg in departments_config:
            dept_name = dept_cfg["name"]
            domain = dept_cfg.get("domain_specialization", "general")
            member_ids: list[str] = dept_cfg.get("member_ids", [])

            members = [people_map[pid] for pid in member_ids if pid in people_map]
            if len(members) < 2:
                raise ProfileBuildError(
                    f"Department '{dept_name}' needs >= 2 members, got {len(members)}"
                )

            dept = self._builder.build_department(members, dept_name, domain)
            departments[dept.department_id] = dept
            department_members[dept.department_id] = [m.profile_id for m in members]

            for pid in member_ids:
                if pid in people_map:
                    person_departments.setdefault(pid, []).append(dept.department_id)

        dept_list = list(departments.values())
        org = self._builder.build_organization(
            dept_list,
            org_name=org_config["name"],
            editorial_style_guide=org_config.get("editorial_style_guide"),
            official_positions=org_config.get("official_positions"),
            prohibited_framings=org_config.get("prohibited_framings"),
            voice_definitions=org_config.get("voice_definitions"),
        )

        return ProfileHierarchy(
            hierarchy_id=_cuid(),
            org_profile=org,
            departments=departments,
            people=people_map,
            department_members=department_members,
            person_departments=person_departments,
        )

    # ── Add person ─────────────────────────────────────────────────────

    def add_person(
        self,
        hierarchy: ProfileHierarchy,
        profile: AuthorProfile,
        dept_ids: list[str],
    ) -> ProfileHierarchy:
        """Add a person to the hierarchy and update affected department composites.

        dept_ids: existing department IDs the person joins.
        Raises HierarchyValidationError for unknown departments.
        """
        for did in dept_ids:
            if did not in hierarchy.departments:
                raise HierarchyValidationError(
                    f"Cannot add person to unknown department '{did}'"
                )

        people = dict(hierarchy.people)
        people[profile.profile_id] = profile

        department_members = {k: list(v) for k, v in hierarchy.department_members.items()}
        person_departments = {k: list(v) for k, v in hierarchy.person_departments.items()}

        person_departments[profile.profile_id] = list(dept_ids)
        for did in dept_ids:
            members = department_members.setdefault(did, [])
            if profile.profile_id not in members:
                members.append(profile.profile_id)

        # Rebuild affected departments
        departments = dict(hierarchy.departments)
        for did in dept_ids:
            member_ids = department_members[did]
            members = [people[pid] for pid in member_ids if pid in people]
            if len(members) >= 2:
                existing = departments[did]
                rebuilt = self._builder.build_department(
                    members,
                    existing.name,
                    existing.domain_specialization,
                )
                # Preserve the original department_id
                rebuilt = rebuilt.model_copy(update={"department_id": did})
                departments[did] = rebuilt

        return ProfileHierarchy(
            hierarchy_id=hierarchy.hierarchy_id,
            org_profile=hierarchy.org_profile,
            departments=departments,
            people=people,
            department_members=department_members,
            person_departments=person_departments,
            version=hierarchy.version,
        )

    # ── Remove person ──────────────────────────────────────────────────

    def remove_person(
        self,
        hierarchy: ProfileHierarchy,
        person_id: str,
    ) -> ProfileHierarchy:
        """Remove a person and rebuild all departments they belonged to.

        Raises HierarchyValidationError if person_id is not in hierarchy.
        """
        if person_id not in hierarchy.people:
            raise HierarchyValidationError(
                f"Person '{person_id}' not found in hierarchy"
            )

        affected_depts = list(hierarchy.person_departments.get(person_id, []))

        people = {pid: p for pid, p in hierarchy.people.items() if pid != person_id}

        department_members = {k: list(v) for k, v in hierarchy.department_members.items()}
        for did in affected_depts:
            if did in department_members:
                department_members[did] = [
                    pid for pid in department_members[did] if pid != person_id
                ]

        person_departments = {
            pid: list(depts)
            for pid, depts in hierarchy.person_departments.items()
            if pid != person_id
        }

        # Rebuild affected departments (skip if < 2 members remain)
        departments = dict(hierarchy.departments)
        for did in affected_depts:
            member_ids = department_members.get(did, [])
            members = [people[pid] for pid in member_ids if pid in people]
            if len(members) >= 2:
                existing = departments[did]
                rebuilt = self._builder.build_department(
                    members,
                    existing.name,
                    existing.domain_specialization,
                )
                rebuilt = rebuilt.model_copy(update={"department_id": did})
                departments[did] = rebuilt
            # If fewer than 2 members remain, preserve existing composite as-is
            # (caller is responsible for handling under-staffed departments)

        return ProfileHierarchy(
            hierarchy_id=hierarchy.hierarchy_id,
            org_profile=hierarchy.org_profile,
            departments=departments,
            people=people,
            department_members=department_members,
            person_departments=person_departments,
            version=hierarchy.version,
        )

    # ── Rebuild composites ─────────────────────────────────────────────

    def rebuild_composites(self, hierarchy: ProfileHierarchy) -> ProfileHierarchy:
        """Full rebuild of all department composites from current people.

        Org-level composite is rebuilt from the updated departments.
        """
        departments = {}
        for dept_id, dept in hierarchy.departments.items():
            member_ids = hierarchy.department_members.get(dept_id, [])
            members = [
                hierarchy.people[pid] for pid in member_ids if pid in hierarchy.people
            ]
            if len(members) >= 2:
                rebuilt = self._builder.build_department(
                    members,
                    dept.name,
                    dept.domain_specialization,
                )
                rebuilt = rebuilt.model_copy(update={"department_id": dept_id})
                departments[dept_id] = rebuilt
            else:
                departments[dept_id] = dept

        # Rebuild org from updated departments
        dept_list = list(departments.values())
        org = hierarchy.org_profile
        if dept_list:
            rebuilt_org = self._builder.build_organization(
                dept_list,
                org_name=org.name,
                editorial_style_guide=org.editorial_style_guide,
                official_positions=org.official_positions,
                prohibited_framings=org.prohibited_framings,
                voice_definitions=org.voice_definitions,
            )
            rebuilt_org = rebuilt_org.model_copy(update={"org_id": org.org_id})
        else:
            rebuilt_org = org

        return ProfileHierarchy(
            hierarchy_id=hierarchy.hierarchy_id,
            org_profile=rebuilt_org,
            departments=departments,
            people=dict(hierarchy.people),
            department_members={k: list(v) for k, v in hierarchy.department_members.items()},
            person_departments={k: list(v) for k, v in hierarchy.person_departments.items()},
            version=hierarchy.version,
        )

    # ── Cascade: prohibited framings ───────────────────────────────────

    def update_prohibited_framings(
        self,
        hierarchy: ProfileHierarchy,
        framings: list[ProhibitedFraming],
    ) -> ProfileHierarchy:
        """Cascade new prohibited framings to all levels (idempotent).

        - Org: adds to org.prohibited_framings (dedup by text)
        - Departments: adds to dept overrides (informational)
        - People: adds framing.text to anti_patterns.prohibited_phrases
        """
        new_texts = {f.text for f in framings}

        # Update org
        existing_org_texts = {f.text for f in hierarchy.org_profile.prohibited_framings}
        combined_framings = list(hierarchy.org_profile.prohibited_framings)
        for f in framings:
            if f.text not in existing_org_texts:
                combined_framings.append(f)

        org = hierarchy.org_profile.model_copy(
            update={"prohibited_framings": combined_framings}
        )

        # Update people: add to anti_patterns.prohibited_phrases (dedup)
        people: dict[str, AuthorProfile] = {}
        for pid, person in hierarchy.people.items():
            existing_phrases = set(person.anti_patterns.prohibited_phrases)
            new_phrases = list(person.anti_patterns.prohibited_phrases)
            for text in new_texts:
                if text not in existing_phrases:
                    new_phrases.append(text)
            updated_anti = person.anti_patterns.model_copy(
                update={"prohibited_phrases": new_phrases}
            )
            people[pid] = person.model_copy(update={"anti_patterns": updated_anti})

        return ProfileHierarchy(
            hierarchy_id=hierarchy.hierarchy_id,
            org_profile=org,
            departments=dict(hierarchy.departments),
            people=people,
            department_members={k: list(v) for k, v in hierarchy.department_members.items()},
            person_departments={k: list(v) for k, v in hierarchy.person_departments.items()},
            version=hierarchy.version,
        )

    # ── Cascade: official position ─────────────────────────────────────

    def update_official_position(
        self,
        hierarchy: ProfileHierarchy,
        position: OfficialPosition,
    ) -> ProfileHierarchy:
        """Update an org-level position. If authoritative=True, override matching
        individual positions on the same topic (idempotent by topic).

        - Org: upsert by topic in official_positions
        - People (if authoritative): replace any position with same topic
        """
        # Upsert in org official positions (dedup by topic)
        existing_positions = [
            p for p in hierarchy.org_profile.official_positions if p.topic != position.topic
        ]
        existing_positions.append(position)
        org = hierarchy.org_profile.model_copy(
            update={"official_positions": existing_positions}
        )

        people = dict(hierarchy.people)
        if position.authoritative:
            from joyus_profile.models.profile import Position as PersonPosition

            updated_people: dict[str, AuthorProfile] = {}
            for pid, person in people.items():
                # Remove any existing position with same topic, then add org's stance
                new_positions = [
                    p for p in person.positions if p.topic != position.topic
                ]
                new_positions.append(
                    PersonPosition(
                        topic=position.topic,
                        stance=position.stance,
                        strength=1.0,
                        context=position.context,
                    )
                )
                updated_people[pid] = person.model_copy(update={"positions": new_positions})
            people = updated_people

        return ProfileHierarchy(
            hierarchy_id=hierarchy.hierarchy_id,
            org_profile=org,
            departments=dict(hierarchy.departments),
            people=people,
            department_members={k: list(v) for k, v in hierarchy.department_members.items()},
            person_departments={k: list(v) for k, v in hierarchy.person_departments.items()},
            version=hierarchy.version,
        )

    # ── Diff ───────────────────────────────────────────────────────────

    def diff(
        self,
        old: ProfileHierarchy,
        new: ProfileHierarchy,
    ) -> HierarchyDiff:
        """Compare two ProfileHierarchy instances and return a HierarchyDiff."""
        old_people_ids = set(old.people)
        new_people_ids = set(new.people)
        added_people = sorted(new_people_ids - old_people_ids)
        removed_people = sorted(old_people_ids - new_people_ids)

        modified_people: list[ProfileDiff] = []
        for pid in old_people_ids & new_people_ids:
            pdiff = self._diff_author_profiles(pid, old.people[pid], new.people[pid])
            if pdiff.changed_sections:
                modified_people.append(pdiff)

        old_dept_ids = set(old.departments)
        new_dept_ids = set(new.departments)
        added_departments = sorted(new_dept_ids - old_dept_ids)
        removed_departments = sorted(old_dept_ids - new_dept_ids)

        modified_departments: list[ProfileDiff] = []
        for did in old_dept_ids & new_dept_ids:
            ddiff = self._diff_department_profiles(
                did, old.departments[did], new.departments[did]
            )
            if ddiff.changed_sections:
                modified_departments.append(ddiff)

        org_changes = self._diff_org_profiles(old.org_profile, new.org_profile)
        if not org_changes.changed_sections:
            org_changes = None

        return HierarchyDiff(
            added_people=added_people,
            removed_people=removed_people,
            modified_people=modified_people,
            added_departments=added_departments,
            removed_departments=removed_departments,
            modified_departments=modified_departments,
            org_changes=org_changes,
        )

    def _diff_author_profiles(
        self, profile_id: str, old: AuthorProfile, new: AuthorProfile
    ) -> ProfileDiff:
        changed: list[str] = []

        # vocabulary
        if (
            old.vocabulary.signature_phrases != new.vocabulary.signature_phrases
            or old.vocabulary.preferred_terms != new.vocabulary.preferred_terms
            or old.vocabulary.technical_terms != new.vocabulary.technical_terms
            or old.vocabulary.avoided_terms != new.vocabulary.avoided_terms
        ):
            changed.append("vocabulary")

        # positions
        old_pos = {p.topic: p.stance for p in old.positions}
        new_pos = {p.topic: p.stance for p in new.positions}
        if old_pos != new_pos:
            changed.append("positions")

        # voice
        old_v = old.voice
        new_v = new.voice
        if (
            old_v.formality != new_v.formality
            or old_v.emotion != new_v.emotion
            or old_v.directness != new_v.directness
            or old_v.complexity != new_v.complexity
        ):
            changed.append("voice")

        # stylometric_features
        if old.stylometric_features != new.stylometric_features:
            # Only flag meaningful deltas (> 0.01)
            if self._has_meaningful_stylo_delta(old, new):
                changed.append("stylometric_features")

        # anti_patterns
        if old.anti_patterns.prohibited_phrases != new.anti_patterns.prohibited_phrases:
            changed.append("anti_patterns")

        sections_str = ", ".join(changed) if changed else ""
        return ProfileDiff(
            profile_id=profile_id,
            changed_sections=changed,
            summary=f"Changed: {sections_str}" if changed else "",
        )

    def _has_meaningful_stylo_delta(
        self, old: AuthorProfile, new: AuthorProfile
    ) -> bool:
        """Return True if any feature mean delta exceeds 0.01 threshold."""
        old_f = old.stylometric_features
        new_f = new.stylometric_features
        if old_f is None and new_f is None:
            return False
        if old_f is None or new_f is None:
            return True
        all_keys = set(old_f.function_word_frequencies) | set(
            new_f.function_word_frequencies
        )
        for key in all_keys:
            old_val = old_f.function_word_frequencies.get(key, 0.0)
            new_val = new_f.function_word_frequencies.get(key, 0.0)
            if abs(old_val - new_val) > 0.01:
                return True
        return False

    def _diff_department_profiles(
        self, dept_id: str, old: DepartmentProfile, new: DepartmentProfile
    ) -> ProfileDiff:
        changed: list[str] = []

        # vocabulary
        if old.shared_vocabulary != new.shared_vocabulary:
            changed.append("vocabulary")

        # positions
        old_pos = {p.topic: p.stance for p in old.shared_positions}
        new_pos = {p.topic: p.stance for p in new.shared_positions}
        if old_pos != new_pos:
            changed.append("positions")

        # stylometric baseline
        if self._has_meaningful_baseline_delta(
            old.stylometric_baseline, new.stylometric_baseline
        ):
            changed.append("stylometric_baseline")

        # member composition
        if set(old.member_ids) != set(new.member_ids):
            changed.append("members")

        sections_str = ", ".join(changed) if changed else ""
        return ProfileDiff(
            profile_id=dept_id,
            changed_sections=changed,
            summary=f"Changed: {sections_str}" if changed else "",
        )

    def _diff_org_profiles(
        self, old: OrganizationProfile, new: OrganizationProfile
    ) -> ProfileDiff:
        changed: list[str] = []

        old_pos = {p.topic: p.stance for p in old.official_positions}
        new_pos = {p.topic: p.stance for p in new.official_positions}
        if old_pos != new_pos:
            changed.append("official_positions")

        old_framings = {f.text for f in old.prohibited_framings}
        new_framings = {f.text for f in new.prohibited_framings}
        if old_framings != new_framings:
            changed.append("prohibited_framings")

        if set(old.voice_definitions) != set(new.voice_definitions):
            changed.append("voice_definitions")

        if self._has_meaningful_baseline_delta(
            old.stylometric_baseline, new.stylometric_baseline
        ):
            changed.append("stylometric_baseline")

        sections_str = ", ".join(changed) if changed else ""
        return ProfileDiff(
            profile_id=old.org_id,
            changed_sections=changed,
            summary=f"Changed: {sections_str}" if changed else "",
        )

    def _has_meaningful_baseline_delta(
        self, old: StylometricBaseline, new: StylometricBaseline
    ) -> bool:
        all_keys = set(old.feature_means) | set(new.feature_means)
        for key in all_keys:
            old_val = old.feature_means.get(key, 0.0)
            new_val = new.feature_means.get(key, 0.0)
            if abs(old_val - new_val) > 0.01:
                return True
        return False
