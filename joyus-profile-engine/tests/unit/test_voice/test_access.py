"""Tests for AccessChecker."""

from __future__ import annotations

import pytest

from joyus_profile.models.profile import AuthorProfile, ContentAccessLevel
from joyus_profile.voice.access import AccessChecker


@pytest.fixture()
def checker() -> AccessChecker:
    return AccessChecker()


class TestCanAccessVoice:
    """Access level enforcement for voice contexts."""

    def test_nonexistent_voice_returns_false(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "does-not-exist", ContentAccessLevel.INTERNAL
        )
        assert result is False

    def test_unrestricted_voice_accessible_by_public(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "public", ContentAccessLevel.PUBLIC
        )
        assert result is True

    def test_unrestricted_voice_accessible_by_subscriber(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "public", ContentAccessLevel.SUBSCRIBER
        )
        assert result is True

    def test_unrestricted_voice_accessible_by_internal(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "public", ContentAccessLevel.INTERNAL
        )
        assert result is True

    def test_subscriber_voice_denied_to_public(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "subscriber-only", ContentAccessLevel.PUBLIC
        )
        assert result is False

    def test_subscriber_voice_accessible_to_subscriber(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "subscriber-only", ContentAccessLevel.SUBSCRIBER
        )
        assert result is True

    def test_subscriber_voice_accessible_to_group(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "subscriber-only", ContentAccessLevel.GROUP
        )
        assert result is True

    def test_internal_voice_denied_to_public(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "internal", ContentAccessLevel.PUBLIC
        )
        assert result is False

    def test_internal_voice_denied_to_subscriber(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "internal", ContentAccessLevel.SUBSCRIBER
        )
        assert result is False

    def test_internal_voice_accessible_to_internal(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        result = checker.can_access_voice(
            layer_2_profile, "internal", ContentAccessLevel.INTERNAL
        )
        assert result is True

    def test_layer_1_unrestricted_voices_accessible_to_all(
        self, checker: AccessChecker, layer_1_profile: AuthorProfile
    ) -> None:
        for voice_key in ("formal", "accessible", "technical"):
            for level in ContentAccessLevel:
                assert checker.can_access_voice(layer_1_profile, voice_key, level) is True, (
                    f"Expected {voice_key} accessible to {level}"
                )


class TestGetSanitizedProfile:
    """Sanitized profile strips restricted voice contexts."""

    def test_sanitized_removes_restricted_voices(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        sanitized = checker.get_sanitized_profile(layer_2_profile)
        assert "subscriber-only" not in sanitized.voice_contexts
        assert "internal" not in sanitized.voice_contexts

    def test_sanitized_keeps_unrestricted_voices(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        sanitized = checker.get_sanitized_profile(layer_2_profile)
        assert "public" in sanitized.voice_contexts

    def test_sanitized_does_not_mutate_original(
        self, checker: AccessChecker, layer_2_profile: AuthorProfile
    ) -> None:
        checker.get_sanitized_profile(layer_2_profile)
        assert "subscriber-only" in layer_2_profile.voice_contexts
        assert "internal" in layer_2_profile.voice_contexts

    def test_sanitized_layer_1_profile_unchanged(
        self, checker: AccessChecker, layer_1_profile: AuthorProfile
    ) -> None:
        """All layer_1 voices are unrestricted — sanitized profile keeps all."""
        sanitized = checker.get_sanitized_profile(layer_1_profile)
        assert set(sanitized.voice_contexts.keys()) == {"formal", "accessible", "technical"}
