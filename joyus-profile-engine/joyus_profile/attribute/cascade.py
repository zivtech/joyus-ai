"""Attribution cascade engine: person → department → org → outsider."""

from __future__ import annotations

import hashlib

from cuid2 import cuid_wrapper

from joyus_profile.models.attribution import AttributionResult, CandidateMatch
from joyus_profile.models.features import MarkerSet, StylometricFeatures, VocabularyProfile
from joyus_profile.models.hierarchy import DepartmentProfile, OrganizationProfile, ProfileHierarchy
from joyus_profile.models.profile import AuthorProfile

_cuid = cuid_wrapper()

# Cascade thresholds
_PERSON_THRESHOLD = 0.85
_DEPT_THRESHOLD = 0.80
_ORG_THRESHOLD = 0.70

# Scoring weights
_W_MARKERS = 0.4
_W_VOCAB = 0.3
_W_STYLO = 0.3


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _score_markers(text: str, markers: MarkerSet | None) -> tuple[float, list[str]]:
    """Score text against a MarkerSet. Returns (score, matched_marker_texts)."""
    if markers is None:
        return 0.0, []

    text_lower = text.lower()
    matched: list[str] = []
    total_weight = 0.0
    matched_weight = 0.0

    all_markers = list(markers.high_signal) + list(markers.medium_signal)
    negative = list(markers.negative_markers)

    for m in all_markers:
        total_weight += m.weight
        if m.text.lower() in text_lower:
            matched_weight += m.weight
            matched.append(m.text)

    # Penalise negative marker hits
    for m in negative:
        if m.text.lower() in text_lower:
            matched_weight -= m.weight * 0.5

    if total_weight == 0.0:
        return 0.0, matched

    score = max(0.0, min(1.0, matched_weight / total_weight))
    return score, matched


def _score_vocabulary(text: str, vocab: VocabularyProfile) -> float:
    """Score text against a VocabularyProfile."""
    text_lower = text.lower()
    hits = 0
    total = 0

    all_terms = (
        vocab.signature_phrases
        + vocab.preferred_terms
        + vocab.technical_terms
    )
    for term in all_terms:
        total += 1
        if term.lower() in text_lower:
            hits += 1

    # Penalty: each avoided term subtracts 1/total (aggressive relative to marker penalty).
    # Clamped to [0.0, 1.0] at the end.
    for term in vocab.avoided_terms:
        if term.lower() in text_lower:
            hits -= 1

    if total == 0:
        return 0.0

    return max(0.0, min(1.0, hits / total))


def _score_stylometric(
    text: str,
    features: StylometricFeatures | None,
) -> float:
    """Score text against stylometric features via function word frequency comparison."""
    if features is None or not features.function_word_frequencies:
        return 0.0

    words = text.lower().split()
    if not words:
        return 0.0

    word_counts: dict[str, int] = {}
    for w in words:
        word_counts[w] = word_counts.get(w, 0) + 1

    profile_freqs = features.function_word_frequencies
    total_diff = 0.0
    compared = 0

    for word, profile_freq in profile_freqs.items():
        text_freq = word_counts.get(word, 0) / len(words)
        total_diff += abs(profile_freq - text_freq)
        compared += 1

    if compared == 0:
        return 0.0

    avg_diff = total_diff / compared
    # Map avg diff to similarity: diff of 0 -> 1.0, diff of 0.1+ -> 0.0
    score = max(0.0, 1.0 - avg_diff * 10.0)
    return score


def _redistribute_weights(
    has_markers: bool, has_vocab: bool, has_stylo: bool
) -> tuple[float, float, float]:
    """Redistribute weights when some scoring components are unavailable."""
    active: list[tuple[str, float]] = []
    if has_markers:
        active.append(("m", _W_MARKERS))
    if has_vocab:
        active.append(("v", _W_VOCAB))
    if has_stylo:
        active.append(("s", _W_STYLO))

    if not active:
        return 0.0, 0.0, 0.0

    total = sum(w for _, w in active)
    weights = {k: w / total for k, w in active}
    return weights.get("m", 0.0), weights.get("v", 0.0), weights.get("s", 0.0)


def _score_person_profile(text: str, profile: AuthorProfile) -> CandidateMatch:
    """Compute a weighted similarity score for a person profile."""
    marker_score, matched = _score_markers(text, profile.markers)
    vocab_score = _score_vocabulary(text, profile.vocabulary)
    stylo_score = _score_stylometric(text, profile.stylometric_features)

    has_markers = profile.markers is not None and bool(
        profile.markers.high_signal or profile.markers.medium_signal
    )
    has_vocab = bool(
        profile.vocabulary.signature_phrases
        or profile.vocabulary.preferred_terms
        or profile.vocabulary.technical_terms
    )
    has_stylo = (
        profile.stylometric_features is not None
        and bool(profile.stylometric_features.function_word_frequencies)
    )

    wm, wv, ws = _redistribute_weights(has_markers, has_vocab, has_stylo)
    combined = wm * marker_score + wv * vocab_score + ws * stylo_score

    return CandidateMatch(
        profile_id=profile.profile_id,
        profile_type="person",
        score=round(combined, 4),
        feature_breakdown={
            "markers": round(marker_score, 4),
            "vocabulary": round(vocab_score, 4),
            "stylometric": round(stylo_score, 4),
        },
        matched_markers=matched,
    )


def _score_dept_profile(text: str, dept: DepartmentProfile) -> CandidateMatch:
    """Compute a weighted similarity score for a department profile."""
    # Departments have shared_vocabulary and stylometric_baseline (feature_means as proxy)
    vocab_score = _score_vocabulary(text, dept.shared_vocabulary)

    # Build a proxy StylometricFeatures from baseline feature_means
    proxy_features: StylometricFeatures | None = None
    if dept.stylometric_baseline.feature_means:
        from joyus_profile.models.features import StylometricFeatures as StyloFeatures

        proxy_features = StyloFeatures(
            function_word_frequencies=dept.stylometric_baseline.feature_means,
            feature_count=len(dept.stylometric_baseline.feature_means),
        )

    stylo_score = _score_stylometric(text, proxy_features)

    # Departments have no dedicated MarkerSet — use vocab as primary signal
    has_vocab = bool(
        dept.shared_vocabulary.signature_phrases
        or dept.shared_vocabulary.preferred_terms
        or dept.shared_vocabulary.technical_terms
    )
    has_stylo = bool(dept.stylometric_baseline.feature_means)
    # Redistribute: vocab absorbs marker weight since depts lack markers
    _, wv, ws = _redistribute_weights(False, has_vocab, has_stylo)
    combined = wv * vocab_score + ws * stylo_score

    return CandidateMatch(
        profile_id=dept.department_id,
        profile_type="department",
        score=round(combined, 4),
        feature_breakdown={
            "markers": 0.0,
            "vocabulary": round(vocab_score, 4),
            "stylometric": round(stylo_score, 4),
        },
        matched_markers=[],
    )


def _score_org_profile(text: str, org: OrganizationProfile) -> CandidateMatch:
    """Compute a similarity score for the org profile."""
    proxy_features: StylometricFeatures | None = None
    if org.stylometric_baseline.feature_means:
        from joyus_profile.models.features import StylometricFeatures as StyloFeatures

        proxy_features = StyloFeatures(
            function_word_frequencies=org.stylometric_baseline.feature_means,
            feature_count=len(org.stylometric_baseline.feature_means),
        )

    stylo_score = _score_stylometric(text, proxy_features)

    # Also score against prohibited framings (inverse — their presence lowers the org score)
    framing_hits = sum(
        1 for pf in org.prohibited_framings if pf.text.lower() in text.lower()
    )
    framing_penalty = min(1.0, framing_hits * 0.1)
    adjusted_stylo = max(0.0, stylo_score - framing_penalty)

    combined = adjusted_stylo  # Org only has stylometric baseline for scoring

    return CandidateMatch(
        profile_id=org.org_id,
        profile_type="org",
        score=round(combined, 4),
        feature_breakdown={
            "stylometric": round(adjusted_stylo, 4),
            "framing_penalty": round(framing_penalty, 4),
        },
        matched_markers=[],
    )


class AttributionEngine:
    """Full cascade attribution: person → department → org → outsider."""

    def __init__(self, hierarchy: ProfileHierarchy) -> None:
        self.hierarchy = hierarchy

    def identify(self, text: str) -> AttributionResult:
        """Full cascade attribution against the whole hierarchy."""
        text_hash = _hash_text(text)

        # Level 1: score all people
        person_candidates = [
            _score_person_profile(text, profile)
            for profile in self.hierarchy.people.values()
        ]
        person_candidates.sort(key=lambda c: c.score, reverse=True)

        best_person = person_candidates[0] if person_candidates else None
        if best_person and best_person.score >= _PERSON_THRESHOLD:
            return AttributionResult(
                result_id=_cuid(),
                text_hash=text_hash,
                mode="identify",
                match_level="person",
                target_id=best_person.profile_id,
                candidates=person_candidates[:10],
                confidence=best_person.score,
                explanation_tier="pattern",
                explanation=(
                    f"Matched person '{best_person.profile_id}' "
                    f"with score {best_person.score:.3f}"
                ),
            )

        # Level 2: score departments
        dept_candidates = [
            _score_dept_profile(text, dept)
            for dept in self.hierarchy.departments.values()
        ]
        dept_candidates.sort(key=lambda c: c.score, reverse=True)

        best_dept = dept_candidates[0] if dept_candidates else None
        if best_dept and best_dept.score >= _DEPT_THRESHOLD:
            all_candidates = person_candidates[:5] + dept_candidates
            all_candidates.sort(key=lambda c: c.score, reverse=True)
            return AttributionResult(
                result_id=_cuid(),
                text_hash=text_hash,
                mode="identify",
                match_level="department",
                target_id=best_dept.profile_id,
                candidates=all_candidates[:10],
                confidence=best_dept.score,
                explanation_tier="pattern",
                explanation=(
                    f"Matched department '{best_dept.profile_id}' "
                    f"with score {best_dept.score:.3f}"
                ),
            )

        # Level 3: score org
        org_candidate = _score_org_profile(text, self.hierarchy.org_profile)
        if org_candidate.score >= _ORG_THRESHOLD:
            all_candidates = person_candidates[:5] + dept_candidates[:3] + [org_candidate]
            all_candidates.sort(key=lambda c: c.score, reverse=True)
            return AttributionResult(
                result_id=_cuid(),
                text_hash=text_hash,
                mode="identify",
                match_level="org",
                target_id=org_candidate.profile_id,
                candidates=all_candidates[:10],
                confidence=org_candidate.score,
                explanation_tier="pattern",
                explanation=(
                    f"Matched organisation '{org_candidate.profile_id}' "
                    f"with score {org_candidate.score:.3f}"
                ),
            )

        # Level 4: outsider
        best_score = max(
            [c.score for c in person_candidates] if person_candidates else [0.0]
        )
        all_candidates = (
            person_candidates[:5]
            + (dept_candidates[:3] if dept_candidates else [])
            + [org_candidate]
        )
        all_candidates.sort(key=lambda c: c.score, reverse=True)
        return AttributionResult(
            result_id=_cuid(),
            text_hash=text_hash,
            mode="identify",
            match_level="outsider",
            target_id=None,
            candidates=all_candidates[:10],
            confidence=round(1.0 - best_score, 4),
            explanation_tier="pattern",
            explanation="No profile matched above threshold — text likely from an outsider.",
        )

    def verify_author(self, text: str, person_id: str) -> AttributionResult:
        """Verify text against a specific known author."""
        text_hash = _hash_text(text)

        if person_id not in self.hierarchy.people:
            return AttributionResult(
                result_id=_cuid(),
                text_hash=text_hash,
                mode="verify_author",
                match_level=None,
                target_id=person_id,
                candidates=[],
                confidence=0.0,
                explanation_tier="pattern",
                explanation=f"Person '{person_id}' not found in hierarchy.",
            )

        profile = self.hierarchy.people[person_id]
        candidate = _score_person_profile(text, profile)

        match_level = "person" if candidate.score >= _PERSON_THRESHOLD else None
        return AttributionResult(
            result_id=_cuid(),
            text_hash=text_hash,
            mode="verify_author",
            match_level=match_level,
            target_id=person_id,
            candidates=[candidate],
            confidence=candidate.score,
            explanation_tier="pattern",
            explanation=(
                f"Verification score for '{person_id}': {candidate.score:.3f} "
                f"(threshold {_PERSON_THRESHOLD})"
            ),
        )

    def validate_department(self, text: str, dept_id: str) -> AttributionResult:
        """Validate text against a specific department."""
        text_hash = _hash_text(text)

        if dept_id not in self.hierarchy.departments:
            return AttributionResult(
                result_id=_cuid(),
                text_hash=text_hash,
                mode="validate_department",
                match_level=None,
                target_id=dept_id,
                candidates=[],
                confidence=0.0,
                explanation_tier="pattern",
                explanation=f"Department '{dept_id}' not found in hierarchy.",
            )

        dept = self.hierarchy.departments[dept_id]
        candidate = _score_dept_profile(text, dept)

        match_level = "department" if candidate.score >= _DEPT_THRESHOLD else None
        return AttributionResult(
            result_id=_cuid(),
            text_hash=text_hash,
            mode="validate_department",
            match_level=match_level,
            target_id=dept_id,
            candidates=[candidate],
            confidence=candidate.score,
            explanation_tier="pattern",
            explanation=(
                f"Validation score for department '{dept_id}': {candidate.score:.3f} "
                f"(threshold {_DEPT_THRESHOLD})"
            ),
        )

    def validate_organization(self, text: str) -> AttributionResult:
        """Validate text against the org profile."""
        text_hash = _hash_text(text)
        org = self.hierarchy.org_profile
        candidate = _score_org_profile(text, org)

        match_level = "org" if candidate.score >= _ORG_THRESHOLD else None
        return AttributionResult(
            result_id=_cuid(),
            text_hash=text_hash,
            mode="validate_organization",
            match_level=match_level,
            target_id=org.org_id,
            candidates=[candidate],
            confidence=candidate.score,
            explanation_tier="pattern",
            explanation=(
                f"Organisation validation score: {candidate.score:.3f} "
                f"(threshold {_ORG_THRESHOLD})"
            ),
        )
