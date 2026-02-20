"""Profile generation: build AuthorProfile from extracted features."""

from __future__ import annotations

from pathlib import Path

import yaml
from cuid2 import cuid_wrapper

from joyus_profile.analyze.audience import AudienceAnalyzer
from joyus_profile.analyze.markers import MarkerAnalyzer
from joyus_profile.analyze.structure import StructureAnalyzer
from joyus_profile.analyze.stylometrics import StylometricAnalyzer
from joyus_profile.analyze.vocabulary import VocabularyAnalyzer
from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import (
    AudienceProfile,
    MarkerSet,
    StructuralPatterns,
    StylometricFeatures,
    VocabularyProfile,
)
from joyus_profile.models.profile import (
    AntiPatterns,
    ArgumentationProfile,
    AuthorProfile,
    CitationProfile,
    EdgeCase,
    ExpertiseDomains,
    Position,
    ValidationCriteria,
    VoiceProfile,
)

TEMPLATES_DIR = Path(__file__).parent / "templates"

_cuid = cuid_wrapper()


class ProfileGenerator:
    """Build a structured AuthorProfile from a processed corpus."""

    def __init__(self, domain: str = "general") -> None:
        self.domain = domain
        self.template = self._load_template(domain)

    def build(
        self,
        corpus: ProcessedCorpus,
        author_name: str,
        domain: str | None = None,
    ) -> AuthorProfile:
        """Run all analyzers and assemble a complete AuthorProfile."""
        effective_domain = domain or self.domain

        # Run all 5 analyzers
        stylo_features = StylometricAnalyzer().extract(corpus)
        marker_set = MarkerAnalyzer().extract(corpus, effective_domain)
        vocab_profile = VocabularyAnalyzer().extract(corpus)
        struct_patterns = StructureAnalyzer().extract(corpus)
        audience_profile = AudienceAnalyzer().extract(corpus)

        return self.build_from_features(
            author_name=author_name,
            domain=effective_domain,
            corpus=corpus,
            stylometric_features=stylo_features,
            markers=marker_set,
            vocabulary=vocab_profile,
            structure=struct_patterns,
            audience=audience_profile,
        )

    def build_from_features(
        self,
        *,
        author_name: str,
        domain: str | None = None,
        corpus: ProcessedCorpus | None = None,
        stylometric_features: StylometricFeatures | None = None,
        markers: MarkerSet | None = None,
        vocabulary: VocabularyProfile | None = None,
        structure: StructuralPatterns | None = None,
        audience: AudienceProfile | None = None,
    ) -> AuthorProfile:
        """Build an AuthorProfile from pre-extracted features."""
        effective_domain = domain or self.domain
        template = self._load_template(effective_domain)
        weights = template.get("section_weights", {})

        corpus_size = corpus.corpus.total_documents if corpus else 0
        word_count = corpus.corpus.total_words if corpus else 0

        tier = self._determine_tier(word_count)

        # §2 Expertise from domain + vocabulary
        expertise = self._build_expertise(
            effective_domain, vocabulary, weights.get("vocabulary", 0.6)
        )

        # §3 Positions from markers (stance indicators)
        positions = self._build_positions(
            markers, weights.get("positions", 0.6)
        )

        # §4 Voice from audience analysis
        voice = self._build_voice(audience, weights.get("voice", 0.6))

        # §6 Vocabulary (direct passthrough)
        vocab_section = vocabulary or VocabularyProfile()

        # §5 Structure (direct passthrough)
        struct_section = structure or StructuralPatterns()

        # §7 Argumentation from structure + markers
        argumentation = self._build_argumentation(
            structure, markers, weights.get("argumentation", 0.6)
        )

        # §8 Citations from structure
        citations = self._build_citations(
            structure, weights.get("citations", 0.6)
        )

        # §9 Anti-patterns from negative markers
        anti_patterns = self._build_anti_patterns(
            markers, weights.get("anti_patterns", 0.6)
        )

        # §11 Edge cases from domain template
        edge_cases = self._build_edge_cases(template)

        # §12 Validation thresholds based on fidelity tier
        validation = self._build_validation(tier, markers)

        # Confidence scoring (T022)
        confidence = self._compute_confidence(
            corpus_size, word_count, stylometric_features
        )

        profile = AuthorProfile(
            profile_id=_cuid(),
            author_name=author_name,
            domain=effective_domain,
            corpus_size=corpus_size,
            word_count=word_count,
            fidelity_tier=tier,
            confidence=confidence,
            # 12 sections
            expertise=expertise,
            positions=positions,
            voice=voice,
            structure=struct_section,
            vocabulary=vocab_section,
            argumentation=argumentation,
            citations=citations,
            anti_patterns=anti_patterns,
            edge_cases=edge_cases,
            validation=validation,
            # Raw features for downstream use
            stylometric_features=stylometric_features,
            markers=markers,
            audience=audience,
            # Layer 0: empty voice_contexts (T021)
            voice_contexts={},
        )

        return profile

    # ── Section builders ──────────────────────────────────────────────

    def _build_expertise(
        self,
        domain: str,
        vocabulary: VocabularyProfile | None,
        weight: float,
    ) -> ExpertiseDomains:
        """Build expertise section from domain and vocabulary analysis."""
        primary = [domain] if domain != "general" else []
        technical = []
        if vocabulary and weight >= 0.5:
            technical = vocabulary.technical_terms[:10]
        return ExpertiseDomains(primary=primary, secondary=technical)

    def _build_positions(
        self, markers: MarkerSet | None, weight: float
    ) -> list[Position]:
        """Derive positions from high-signal markers."""
        if not markers or weight < 0.3:
            return []
        positions = []
        for m in markers.high_signal[:5]:
            positions.append(
                Position(
                    topic=m.domain,
                    stance=m.text,
                    strength=m.weight,
                )
            )
        return positions

    def _build_voice(
        self, audience: AudienceProfile | None, weight: float
    ) -> VoiceProfile:
        """Build voice profile from audience analysis."""
        if not audience:
            return VoiceProfile()
        formality = audience.formality_score if weight >= 0.3 else 5.0
        descriptors = []
        if audience.primary_register:
            descriptors.append(audience.primary_register)
        return VoiceProfile(
            formality=formality,
            tone_descriptors=descriptors,
        )

    def _build_argumentation(
        self,
        structure: StructuralPatterns | None,
        markers: MarkerSet | None,
        weight: float,
    ) -> ArgumentationProfile:
        """Build argumentation profile from structure and markers."""
        if weight < 0.3:
            return ArgumentationProfile()
        evidence_types = []
        reasoning = []
        if structure and structure.citation_density > 0:
            evidence_types.append("citations")
        if structure and structure.list_usage_ratio > 0.1:
            evidence_types.append("enumerated_points")
        if structure and structure.heading_frequency > 0.1:
            reasoning.append("structured_sections")
        if markers:
            for m in markers.high_signal[:3]:
                reasoning.append(f"emphasis: {m.text}")
        return ArgumentationProfile(
            evidence_types=evidence_types,
            reasoning_patterns=reasoning,
        )

    def _build_citations(
        self, structure: StructuralPatterns | None, weight: float
    ) -> CitationProfile:
        """Build citation profile from structural patterns."""
        if not structure or weight < 0.3:
            return CitationProfile()
        return CitationProfile(
            citation_frequency=structure.citation_density,
        )

    def _build_anti_patterns(
        self, markers: MarkerSet | None, weight: float
    ) -> AntiPatterns:
        """Build anti-patterns from negative markers."""
        if not markers or weight < 0.3:
            return AntiPatterns()
        never_do = [m.text for m in markers.negative_markers]
        return AntiPatterns(never_do=never_do)

    def _build_edge_cases(self, template: dict) -> list[EdgeCase]:
        """Build edge cases from domain template."""
        hints = template.get("terminology", {}).get("register_hints", [])
        cases = []
        for hint in hints:
            cases.append(
                EdgeCase(
                    scenario=f"Writing in {hint} register",
                    guidance=f"Maintain {hint} tone throughout.",
                )
            )
        return cases

    def _build_validation(
        self, tier: int, markers: MarkerSet | None
    ) -> ValidationCriteria:
        """Build validation criteria based on fidelity tier."""
        min_score = {1: 0.5, 2: 0.6, 3: 0.7, 4: 0.8}.get(tier, 0.7)
        required = []
        if markers:
            required = [m.text for m in markers.high_signal[:5]]
        return ValidationCriteria(
            minimum_fidelity_score=min_score,
            required_markers=required,
            self_check_questions=[
                "Does the output match the author's formality level?",
                "Are signature phrases present?",
                "Is the domain vocabulary consistent?",
            ],
        )

    # ── Utilities ─────────────────────────────────────────────────────

    def _determine_tier(self, word_count: int) -> int:
        """Determine fidelity tier from corpus word count."""
        if word_count >= 100_000:
            return 4
        if word_count >= 50_000:
            return 3
        if word_count >= 10_000:
            return 2
        return 1

    def _compute_confidence(
        self,
        corpus_size: int,
        word_count: int,
        features: StylometricFeatures | None,
    ) -> float:
        """Compute profile confidence (0.0-1.0) from corpus metrics."""
        # Base confidence from document count
        if corpus_size >= 50:
            base = 0.95
        elif corpus_size >= 20:
            base = 0.85
        elif corpus_size >= 10:
            base = 0.70
        elif corpus_size >= 5:
            base = 0.55
        else:
            base = 0.50

        # Boost for word count
        if word_count >= 100_000:
            base = min(base + 0.05, 1.0)
        elif word_count < 5_000:
            base = max(base - 0.05, 0.5)

        # Penalize high stylometric variance (if available)
        if features and features.sentence_length_stats.std > 0:
            cv = features.sentence_length_stats.std / max(
                features.sentence_length_stats.mean, 1.0
            )
            if cv > 1.5:
                base = max(base - 0.1, 0.5)

        return round(base, 2)

    def _load_template(self, domain: str) -> dict:
        """Load domain template YAML."""
        path = TEMPLATES_DIR / f"{domain}.yaml"
        if not path.exists():
            path = TEMPLATES_DIR / "general.yaml"
        try:
            return yaml.safe_load(path.read_text()) or {}
        except Exception:
            return {}
