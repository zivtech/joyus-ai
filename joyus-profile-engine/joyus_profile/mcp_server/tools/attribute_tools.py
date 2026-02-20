"""Attribution MCP tool handlers (handler logic only, not MCP registration)."""

from __future__ import annotations

from pathlib import Path

from joyus_profile.models.hierarchy import ProfileHierarchy

from joyus_profile.attribute.cascade import AttributionEngine
from joyus_profile.attribute.identifier import AuthorIdentifier
from joyus_profile.attribute.outsider import OutsiderDetector


def load_hierarchy_from_dir(path: str | Path) -> ProfileHierarchy:
    """Load a ProfileHierarchy from a directory of JSON files.

    Args:
        path: Directory containing the emitted hierarchy JSON files.

    Raises:
        NotImplementedError: This depends on the WP09 emission format which is
            built in parallel.  Implement once WP09 is merged.
    """
    raise NotImplementedError(
        "load_hierarchy_from_dir depends on the WP09 hierarchy emission format. "
        "Implement after WP09 is merged."
    )


def handle_identify_author(
    text: str,
    hierarchy_dir: str,
    explanation_tier: str = "pattern",
) -> dict:
    """Identify the most likely author(s) of *text* from the hierarchy.

    Args:
        text: The text whose authorship is to be identified.
        hierarchy_dir: Path to the directory containing hierarchy JSON files.
        explanation_tier: ``"pattern"`` (default, safe for any user) or
            ``"passage"`` (may include source text snippets).

    Returns:
        Serialised :class:`~joyus_profile.models.attribution.AttributionResult`.
    """
    hierarchy = load_hierarchy_from_dir(hierarchy_dir)
    identifier = AuthorIdentifier()
    result = identifier.identify(text, hierarchy, explanation_tier=explanation_tier)
    return result.model_dump(mode="json")


def handle_validate_attribution(
    text: str,
    target_id: str,
    target_type: str,
    hierarchy_dir: str,
) -> dict:
    """Validate *text* against a specific target profile.

    Args:
        text: The text to validate.
        target_id: ID of the person or department to validate against.
            Ignored when *target_type* is ``"org"``.
        target_type: One of ``"person"``, ``"department"``, or ``"org"``.
        hierarchy_dir: Path to the directory containing hierarchy JSON files.

    Returns:
        Serialised :class:`~joyus_profile.models.attribution.AttributionResult`.

    Raises:
        ValueError: If *target_type* is not one of the accepted values.
    """
    hierarchy = load_hierarchy_from_dir(hierarchy_dir)
    engine = AttributionEngine(hierarchy)

    if target_type == "person":
        result = engine.verify_author(text, target_id)
    elif target_type == "department":
        result = engine.validate_department(text, target_id)
    elif target_type == "org":
        result = engine.validate_organization(text)
    else:
        raise ValueError(
            f"Unknown target_type '{target_type}'. "
            "Expected one of: 'person', 'department', 'org'."
        )

    return result.model_dump(mode="json")


def handle_detect_outsider(
    text: str,
    hierarchy_dir: str,
) -> dict:
    """Detect whether *text* was authored by someone outside the hierarchy.

    Args:
        text: The text to evaluate.
        hierarchy_dir: Path to the directory containing hierarchy JSON files.

    Returns:
        Serialised :class:`~joyus_profile.models.attribution.AttributionResult`.
        When ``match_level`` is ``"outsider"``, ``confidence`` reflects how
        strongly no known profile matched.
    """
    hierarchy = load_hierarchy_from_dir(hierarchy_dir)
    detector = OutsiderDetector()
    result = detector.detect(text, hierarchy)
    return result.model_dump(mode="json")
