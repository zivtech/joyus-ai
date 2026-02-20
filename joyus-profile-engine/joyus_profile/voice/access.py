"""AccessChecker: Layer 2 voice access control based on ContentAccessLevel."""

from __future__ import annotations

from joyus_profile.models.profile import AuthorProfile, ContentAccessLevel

# Ordered from least to most privileged
_LEVEL_ORDER: dict[ContentAccessLevel, int] = {
    ContentAccessLevel.PUBLIC: 0,
    ContentAccessLevel.SUBSCRIBER: 1,
    ContentAccessLevel.GROUP: 2,
    ContentAccessLevel.INTERNAL: 3,
}


class AccessChecker:
    """Determines whether a user can access a particular voice on a profile."""

    def can_access_voice(
        self,
        profile: AuthorProfile,
        voice_key: str,
        user_access_level: ContentAccessLevel,
    ) -> bool:
        """Return True if the user's access level permits access to voice_key.

        Rules:
        - voice_key not in profile.voice_contexts → False
        - vc.access_level is None → True (Layer 1, unrestricted)
        - Layer 2: user level must be >= voice required level
        """
        vc = profile.voice_contexts.get(voice_key)
        if vc is None:
            return False

        if vc.access_level is None:
            return True

        required = _LEVEL_ORDER[vc.access_level.level]
        user = _LEVEL_ORDER[user_access_level]
        return user >= required

    def get_sanitized_profile(self, profile: AuthorProfile) -> AuthorProfile:
        """Return profile with restricted voice_contexts removed.

        Only statistical/stylometric sections are retained on the base profile.
        Voice contexts that require any access level are stripped.
        """
        sanitized_contexts = {
            key: vc
            for key, vc in profile.voice_contexts.items()
            if vc.access_level is None
        }
        return profile.model_copy(
            update={"voice_contexts": sanitized_contexts}, deep=True
        )
