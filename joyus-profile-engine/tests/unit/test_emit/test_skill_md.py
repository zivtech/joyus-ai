"""Tests for SKILL.md generation."""

from __future__ import annotations

import pytest

from joyus_profile.emit.skill_md import generate_skill_md
from joyus_profile.models.profile import (
    AntiPatterns,
    AuthorProfile,
    ValidationCriteria,
    VoiceProfile,
    VocabularyProfile,
)


class TestSkillMdGeneration:
    def test_generates_from_profile(self, sample_profile):
        md = generate_skill_md(sample_profile)
        assert "# Writing Profile: Test Author" in md
        assert "## Identity & Background" in md
        assert "## Voice & Tone" in md
        assert "## Vocabulary" in md
        assert "## Anti-Patterns" in md
        assert "## Validation Criteria" in md

    def test_all_12_sections_present(self, sample_profile):
        md = generate_skill_md(sample_profile)
        expected_sections = [
            "Identity & Background",
            "Expertise Domains",
            "Positions & Stances",
            "Voice & Tone",
            "Document Structure",
            "Vocabulary",
            "Argumentation Patterns",
            "Citation Style",
            "Anti-Patterns",
            "Example Outputs",
            "Edge Cases",
            "Validation Criteria",
        ]
        for section in expected_sections:
            assert f"## {section}" in md, f"Missing section: {section}"

    def test_under_500_lines(self, sample_profile):
        md = generate_skill_md(sample_profile)
        lines = md.split("\n")
        assert len(lines) < 500, f"SKILL.md has {len(lines)} lines (max 500)"

    def test_minimal_profile(self):
        """A profile with all defaults should still generate valid Markdown."""
        profile = AuthorProfile(
            profile_id="test_001",
            author_name="Minimal Author",
        )
        md = generate_skill_md(profile)
        assert "# Writing Profile: Minimal Author" in md
        assert "## Identity & Background" in md

    def test_rich_profile(self):
        """A profile with many fields populated should render them all."""
        profile = AuthorProfile(
            profile_id="test_002",
            author_name="Rich Author",
            domain="technical",
            fidelity_tier=3,
            confidence=0.85,
            corpus_size=25,
            word_count=75000,
            voice=VoiceProfile(
                formality=8.0,
                tone_descriptors=["formal", "precise"],
                complexity=7.0,
            ),
            vocabulary=VocabularyProfile(
                signature_phrases=["in accordance with", "as specified"],
                preferred_terms=["utilize", "implement"],
                avoided_terms=["basically", "stuff"],
                technical_terms=["microservice", "orchestration"],
            ),
            anti_patterns=AntiPatterns(
                never_do=["use casual language", "skip citations"],
            ),
            validation=ValidationCriteria(
                minimum_fidelity_score=0.8,
                self_check_questions=["Is tone formal?"],
            ),
        )
        md = generate_skill_md(profile)
        assert "Rich Author" in md
        assert "Tier 3" in md
        assert "0.85" in md
        assert "in accordance with" in md
        assert "casual language" in md
        assert "Complexity" in md  # Non-default complexity renders
