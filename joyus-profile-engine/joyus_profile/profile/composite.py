"""Composite profile builder: department and organization aggregation."""

from __future__ import annotations

from cuid2 import cuid_wrapper

from joyus_profile.exceptions import ProfileBuildError
from joyus_profile.models.features import (
    StructuralPatterns,
    VocabularyProfile,
)
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OfficialPosition,
    OrganizationProfile,
    ProhibitedFraming,
    RegisterInfo,
    StyleGuide,
    StylometricBaseline,
    VoiceDefinition,
)
from joyus_profile.models.profile import AuthorProfile, Position

_cuid = cuid_wrapper()


class CompositeBuilder:
    """Build department and organization composites from member profiles.

    Uses corpus-size weighted mean aggregation for stylometric features
    per research.md §R4.
    """

    # ── Department ────────────────────────────────────────────────────

    def build_department(
        self,
        member_profiles: list[AuthorProfile],
        department_name: str,
        domain_specialization: str = "general",
    ) -> DepartmentProfile:
        """Aggregate person-level profiles into a department composite.

        Requires >= 2 members. Stylometric baseline is weighted by each
        member's corpus word count.
        """
        if len(member_profiles) < 2:
            raise ProfileBuildError(
                f"Department '{department_name}' needs >= 2 members, "
                f"got {len(member_profiles)}"
            )

        shared_vocab = self._intersect_vocabularies(member_profiles)
        shared_positions = self._aggregate_positions(member_profiles)
        structural_range = self._union_structures(member_profiles)
        baseline = self._weighted_mean_features(member_profiles)
        registers = self._merge_registers(member_profiles)

        return DepartmentProfile(
            department_id=_cuid(),
            name=department_name,
            domain_specialization=domain_specialization,
            member_ids=[p.profile_id for p in member_profiles],
            shared_vocabulary=shared_vocab,
            shared_positions=shared_positions,
            structural_range=structural_range,
            stylometric_baseline=baseline,
            audience_registers=registers,
        )

    # ── Organization ──────────────────────────────────────────────────

    def build_organization(
        self,
        department_profiles: list[DepartmentProfile],
        org_name: str,
        editorial_style_guide: StyleGuide | None = None,
        official_positions: list[OfficialPosition] | None = None,
        prohibited_framings: list[ProhibitedFraming] | None = None,
        voice_definitions: dict[str, VoiceDefinition] | None = None,
    ) -> OrganizationProfile:
        """Aggregate department profiles into an organization composite.

        Editorial layer (style guide, positions, prohibitions) overrides
        are applied at the org level. Prohibited framings cascade to all
        departments and people (cannot be overridden).
        """
        if len(department_profiles) < 1:
            raise ProfileBuildError(
                f"Organization '{org_name}' needs >= 1 department, got 0"
            )

        baseline = self._weighted_mean_dept_features(department_profiles)

        return OrganizationProfile(
            org_id=_cuid(),
            name=org_name,
            editorial_style_guide=editorial_style_guide or StyleGuide(),
            official_positions=official_positions or [],
            prohibited_framings=prohibited_framings or [],
            voice_definitions=voice_definitions or {},
            stylometric_baseline=baseline,
        )

    # ── Incremental update ────────────────────────────────────────────

    def update_department_incremental(
        self,
        existing: DepartmentProfile,
        new_profile: AuthorProfile,
    ) -> DepartmentProfile:
        """Incrementally update a department composite with a new member.

        Uses the incremental formula from research.md §R4:
        new = (old * old_total + new_vec * new_size) / (old_total + new_size)
        """
        old_total = existing.stylometric_baseline.sample_count
        new_size = max(new_profile.word_count, 1)
        combined = old_total + new_size

        updated_means: dict[str, float] = {}
        for key, old_val in existing.stylometric_baseline.feature_means.items():
            new_val = 0.0
            if (
                new_profile.stylometric_features
                and key in new_profile.stylometric_features.function_word_frequencies
            ):
                new_val = new_profile.stylometric_features.function_word_frequencies[key]
            updated_means[key] = (old_val * old_total + new_val * new_size) / combined

        # Add any new keys from the incoming profile
        if new_profile.stylometric_features:
            for key, val in new_profile.stylometric_features.function_word_frequencies.items():
                if key not in updated_means:
                    updated_means[key] = (val * new_size) / combined

        new_baseline = StylometricBaseline(
            feature_means=updated_means,
            feature_stds=existing.stylometric_baseline.feature_stds,
            sample_count=combined,
        )

        member_ids = existing.member_ids[:]
        if new_profile.profile_id not in member_ids:
            member_ids.append(new_profile.profile_id)

        return existing.model_copy(
            update={
                "stylometric_baseline": new_baseline,
                "member_ids": member_ids,
            }
        )

    # ── Private: vocabulary ───────────────────────────────────────────

    def _intersect_vocabularies(
        self, profiles: list[AuthorProfile]
    ) -> VocabularyProfile:
        """Compute shared vocabulary across all members (intersection)."""
        if not profiles:
            return VocabularyProfile()

        sig_sets = [set(p.vocabulary.signature_phrases) for p in profiles]
        pref_sets = [set(p.vocabulary.preferred_terms) for p in profiles]
        tech_sets = [set(p.vocabulary.technical_terms) for p in profiles]

        # Intersection: terms that appear in >= half of members
        threshold = max(len(profiles) // 2, 1)

        shared_sig = self._frequency_threshold(sig_sets, threshold)
        shared_pref = self._frequency_threshold(pref_sets, threshold)
        shared_tech = self._frequency_threshold(tech_sets, threshold)

        # Avoided terms: union (if anyone avoids it, the department notes it)
        all_avoided = set()
        for p in profiles:
            all_avoided.update(p.vocabulary.avoided_terms)

        return VocabularyProfile(
            signature_phrases=sorted(shared_sig),
            preferred_terms=sorted(shared_pref),
            technical_terms=sorted(shared_tech),
            avoided_terms=sorted(all_avoided),
        )

    # ── Private: positions ────────────────────────────────────────────

    def _aggregate_positions(
        self, profiles: list[AuthorProfile]
    ) -> list[Position]:
        """Compute consensus positions (topics where members agree)."""
        topic_stances: dict[str, list[Position]] = {}
        for p in profiles:
            for pos in p.positions:
                topic_stances.setdefault(pos.topic, []).append(pos)

        consensus: list[Position] = []
        for topic, positions in topic_stances.items():
            if len(positions) < 2:
                continue
            # Average strength for shared topics
            avg_strength = sum(p.strength for p in positions) / len(positions)
            # Use the most common stance
            stance_counts: dict[str, int] = {}
            for p in positions:
                stance_counts[p.stance] = stance_counts.get(p.stance, 0) + 1
            dominant_stance = max(stance_counts, key=lambda s: stance_counts[s])
            consensus.append(
                Position(
                    topic=topic,
                    stance=dominant_stance,
                    strength=round(avg_strength, 3),
                )
            )
        return consensus

    # ── Private: structure ────────────────────────────────────────────

    def _union_structures(
        self, profiles: list[AuthorProfile]
    ) -> StructuralPatterns:
        """Compute structural range (union of patterns, averaged values)."""
        if not profiles:
            return StructuralPatterns()

        n = len(profiles)
        return StructuralPatterns(
            avg_paragraph_length=sum(
                p.structure.avg_paragraph_length for p in profiles
            )
            / n,
            avg_paragraphs_per_doc=sum(
                p.structure.avg_paragraphs_per_doc for p in profiles
            )
            / n,
            heading_frequency=sum(
                p.structure.heading_frequency for p in profiles
            )
            / n,
            list_usage_ratio=sum(
                p.structure.list_usage_ratio for p in profiles
            )
            / n,
            citation_density=sum(
                p.structure.citation_density for p in profiles
            )
            / n,
        )

    # ── Private: stylometric baseline ─────────────────────────────────

    def _weighted_mean_features(
        self, profiles: list[AuthorProfile]
    ) -> StylometricBaseline:
        """Compute corpus-size weighted mean of stylometric features."""
        total_words = sum(p.word_count for p in profiles)
        if total_words == 0:
            return StylometricBaseline(sample_count=0)

        weights = {p.profile_id: p.word_count / total_words for p in profiles}

        # Collect all feature keys
        all_keys: set[str] = set()
        for p in profiles:
            if p.stylometric_features:
                all_keys.update(p.stylometric_features.function_word_frequencies.keys())

        # Weighted mean per feature
        means: dict[str, float] = {}
        for key in all_keys:
            weighted_sum = 0.0
            for p in profiles:
                freq = 0.0
                if p.stylometric_features:
                    freq = p.stylometric_features.function_word_frequencies.get(key, 0.0)
                weighted_sum += freq * weights[p.profile_id]
            means[key] = weighted_sum

        # Weighted standard deviation per feature
        stds: dict[str, float] = {}
        for key in all_keys:
            mean_val = means[key]
            variance_sum = 0.0
            for p in profiles:
                freq = 0.0
                if p.stylometric_features:
                    freq = p.stylometric_features.function_word_frequencies.get(key, 0.0)
                variance_sum += weights[p.profile_id] * (freq - mean_val) ** 2
            stds[key] = variance_sum**0.5

        return StylometricBaseline(
            feature_means=means,
            feature_stds=stds,
            sample_count=total_words,
        )

    def _weighted_mean_dept_features(
        self, departments: list[DepartmentProfile]
    ) -> StylometricBaseline:
        """Compute weighted mean across department baselines."""
        total = sum(d.stylometric_baseline.sample_count for d in departments)
        if total == 0:
            return StylometricBaseline(sample_count=0)

        weights = {
            d.department_id: d.stylometric_baseline.sample_count / total
            for d in departments
        }

        all_keys: set[str] = set()
        for d in departments:
            all_keys.update(d.stylometric_baseline.feature_means.keys())

        means: dict[str, float] = {}
        for key in all_keys:
            weighted_sum = 0.0
            for d in departments:
                val = d.stylometric_baseline.feature_means.get(key, 0.0)
                weighted_sum += val * weights[d.department_id]
            means[key] = weighted_sum

        return StylometricBaseline(
            feature_means=means,
            feature_stds={},
            sample_count=total,
        )

    # ── Private: registers ────────────────────────────────────────────

    def _merge_registers(
        self, profiles: list[AuthorProfile]
    ) -> dict[str, RegisterInfo]:
        """Merge audience registers from all members."""
        registers: dict[str, RegisterInfo] = {}
        for p in profiles:
            if not p.audience:
                continue
            reg_name = p.audience.primary_register
            if reg_name in registers:
                info = registers[reg_name]
                info.frequency += 1.0
                if p.profile_id not in info.contributors:
                    info.contributors.append(p.profile_id)
            else:
                registers[reg_name] = RegisterInfo(
                    register_name=reg_name,
                    frequency=1.0,
                    contributors=[p.profile_id],
                )
        return registers

    # ── Private: helpers ──────────────────────────────────────────────

    @staticmethod
    def _frequency_threshold(
        sets: list[set[str]], threshold: int
    ) -> list[str]:
        """Return items appearing in >= threshold of the sets."""
        counts: dict[str, int] = {}
        for s in sets:
            for item in s:
                counts[item] = counts.get(item, 0) + 1
        return [item for item, count in counts.items() if count >= threshold]
