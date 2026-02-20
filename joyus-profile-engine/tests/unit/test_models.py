"""Unit tests for all Pydantic data models."""

from __future__ import annotations

from datetime import datetime

import pytest
from pydantic import ValidationError

from joyus_profile.models import (
    AuthorProfile,
    Corpus,
    Document,
    DocumentMetadata,
    Marker,
    MarkerSet,
    ProcessedCorpus,
    StylometricFeatures,
    VocabularyProfile,
    VoiceContext,
    VoiceProfile,
)
from joyus_profile.models.attribution import AttributionResult, CandidateMatch
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    OfficialPosition,
    ProfileHierarchy,
    ProhibitedFraming,
    RegisterInfo,
    StyleGuide,
    StylometricBaseline,
    VoiceDefinition,
)
from joyus_profile.models.monitoring import (
    DriftDiagnosis,
    DriftedFeature,
    DriftSignal,
    RepairAction,
)
from joyus_profile.models.content import GeneratedContent, SourceRef
from joyus_profile.models.verification import (
    FidelityScore,
    InlineResult,
    VerificationResult,
)


# --- Corpus models ---


class TestDocumentMetadata:
    def test_defaults(self):
        meta = DocumentMetadata()
        assert meta.source_path is None
        assert meta.word_count == 0

    def test_with_values(self):
        meta = DocumentMetadata(
            source_path="/tmp/doc.txt",
            title="Test Doc",
            word_count=500,
        )
        assert meta.word_count == 500
        assert meta.title == "Test Doc"


class TestDocument:
    def test_minimal(self):
        doc = Document(doc_id="d1", text="Hello world")
        assert doc.doc_id == "d1"
        assert doc.text == "Hello world"
        assert doc.metadata.word_count == 0

    def test_with_metadata(self):
        doc = Document(
            doc_id="d2",
            text="Some content here",
            metadata=DocumentMetadata(word_count=3),
        )
        assert doc.metadata.word_count == 3


class TestCorpus:
    def test_empty_corpus(self):
        corpus = Corpus(documents=[], total_words=0, total_documents=0)
        assert len(corpus.documents) == 0

    def test_with_documents(self, sample_documents):
        corpus = Corpus(
            documents=sample_documents,
            total_words=sum(d.metadata.word_count for d in sample_documents),
            total_documents=len(sample_documents),
        )
        assert corpus.total_documents == len(sample_documents)
        assert corpus.total_words > 0


class TestProcessedCorpus:
    def test_no_chunks(self, sample_corpus):
        pc = ProcessedCorpus(
            corpus=sample_corpus,
            chunks=[],
            total_chunks=0,
            avg_chunk_words=0.0,
        )
        assert pc.total_chunks == 0


# --- Feature models ---


class TestVoiceProfile:
    def test_defaults(self):
        vp = VoiceProfile()
        assert vp.formality == 5.0
        assert vp.tone_descriptors == []

    def test_custom_values(self):
        vp = VoiceProfile(
            formality=8.0,
            emotion=2.0,
            directness=9.0,
            complexity=7.0,
            tone_descriptors=["formal", "precise"],
        )
        assert vp.formality == 8.0
        assert len(vp.tone_descriptors) == 2


class TestVocabularyProfile:
    def test_defaults(self):
        vp = VocabularyProfile()
        assert vp.signature_phrases == []
        assert vp.preferred_terms == []

    def test_with_terms(self):
        vp = VocabularyProfile(
            preferred_terms=["regulation", "compliance"],
            technical_terms=["statute"],
        )
        assert len(vp.preferred_terms) == 2


class TestMarker:
    def test_required_fields(self):
        m = Marker(text="key phrase", weight=0.9)
        assert m.text == "key phrase"
        assert m.weight == 0.9
        assert m.frequency == 0.0

    def test_with_frequency(self):
        m = Marker(text="term", weight=0.5, frequency=0.12)
        assert m.frequency == 0.12


class TestMarkerSet:
    def test_empty(self):
        ms = MarkerSet()
        assert ms.high_signal == []
        assert ms.medium_signal == []
        assert ms.negative_markers == []

    def test_with_markers(self):
        ms = MarkerSet(
            high_signal=[Marker(text="a", weight=0.9)],
            medium_signal=[Marker(text="b", weight=0.5)],
        )
        assert len(ms.high_signal) == 1


class TestStylometricFeatures:
    def test_defaults(self):
        sf = StylometricFeatures()
        assert sf.feature_count == 0
        assert sf.function_word_frequencies == {}
        assert sf.burrows_delta_baseline is None


# --- Profile models ---


class TestAuthorProfile:
    def test_minimal(self):
        profile = AuthorProfile(
            profile_id="p1",
            author_name="Author A",
        )
        assert profile.profile_id == "p1"
        assert profile.domain == "general"
        assert profile.fidelity_tier == 1

    def test_full_profile(self, sample_profile):
        assert sample_profile.profile_id == "test_profile_001"
        assert sample_profile.domain == "legal_advocacy"
        assert sample_profile.fidelity_tier == 2
        assert sample_profile.voice.formality == 7.5
        assert len(sample_profile.markers.high_signal) == 2


class TestVoiceContext:
    def test_minimal(self):
        vc = VoiceContext(voice_id="v1", audience_key="formal")
        assert vc.voice_id == "v1"
        assert vc.fidelity_tier == 1

    def test_with_override(self, sample_voice_context):
        assert sample_voice_context.audience_key == "formal"
        assert sample_voice_context.voice_override is not None
        assert sample_voice_context.voice_override.emotion == 6.5


# --- Verification models ---


class TestFidelityScore:
    def test_required_fields(self):
        fs = FidelityScore(score=0.85, passed=True, tier=1)
        assert fs.score == 0.85
        assert fs.passed is True

    def test_component_scores(self):
        fs = FidelityScore(
            score=0.9,
            passed=True,
            tier=2,
            marker_score=0.92,
            style_score=0.88,
        )
        assert fs.marker_score == 0.92


class TestVerificationResult:
    def test_minimal(self):
        vr = VerificationResult(
            result_id="vr1",
            profile_id="p1",
        )
        assert vr.tier1 is None
        assert vr.voice_key is None


class TestGeneratedContent:
    def test_minimal(self):
        gc = GeneratedContent(
            content_id="gc1",
            text="Generated text here.",
            target_profile="p1",
        )
        assert gc.content_id == "gc1"
        assert gc.target_voice is None
        assert gc.fidelity_score == 0.0


# --- Attribution models ---


class TestCandidateMatch:
    def test_required_fields(self):
        cm = CandidateMatch(
            profile_id="p1",
            score=0.87,
        )
        assert cm.score == 0.87
        assert cm.profile_type == "person"


class TestAttributionResult:
    def test_no_candidates(self):
        ar = AttributionResult(
            result_id="a1",
            text_hash="abc123",
            candidates=[],
        )
        assert ar.confidence == 0.0
        assert ar.candidates == []

    def test_with_candidates(self):
        c1 = CandidateMatch(profile_id="p1", score=0.6)
        c2 = CandidateMatch(profile_id="p2", score=0.9)
        ar = AttributionResult(
            result_id="a2",
            text_hash="def456",
            candidates=[c1, c2],
            confidence=0.9,
        )
        assert ar.confidence == 0.9
        assert len(ar.candidates) == 2


# --- Monitoring models ---


class TestDriftSignal:
    def test_required_fields(self):
        ds = DriftSignal(
            signal_id="ds1",
            profile_id="p1",
            signal_type="vocabulary_shift",
        )
        assert ds.signal_type == "vocabulary_shift"
        assert ds.severity == "medium"
        assert ds.deviation == 0.0
        assert ds.window_end is None


class TestDriftedFeature:
    def test_defaults(self):
        df = DriftedFeature(
            feature_name="formality",
            baseline_value=7.5,
            current_value=4.0,
            deviation_pct=46.7,
        )
        assert df.deviation_pct == 46.7


class TestRepairAction:
    def test_minimal(self):
        ra = RepairAction(
            action_id="ra1",
            action_type="suggestion",
            description="Increase formality",
        )
        assert ra.action_type == "suggestion"
        assert ra.status == "proposed"


class TestDriftDiagnosis:
    def test_no_drifts(self):
        dd = DriftDiagnosis(
            diagnosis_id="dd1",
            profile_id="p1",
            affected_features=[],
        )
        assert len(dd.affected_features) == 0
        assert dd.probable_cause == "unknown"


# --- Hierarchy models ---


class TestRegisterInfo:
    def test_defaults(self):
        ri = RegisterInfo()
        assert ri.register_name == "neutral"
        assert ri.frequency == 0.0


class TestStyleGuide:
    def test_defaults(self):
        sg = StyleGuide()
        assert sg.name == ""
        assert sg.rules == []


class TestOfficialPosition:
    def test_required_fields(self):
        op = OfficialPosition(topic="AI Safety", stance="Supportive")
        assert op.authoritative is False


class TestProhibitedFraming:
    def test_required_field(self):
        pf = ProhibitedFraming(text="never use this")
        assert pf.severity == "high"


class TestVoiceDefinition:
    def test_minimal(self):
        vd = VoiceDefinition(audience_key="formal")
        assert vd.audience_label == ""


class TestDepartmentProfile:
    def test_minimal(self):
        dp = DepartmentProfile(department_id="dept1", name="Compliance")
        assert dp.domain_specialization == "general"
        assert dp.member_ids == []


class TestOrganizationProfile:
    def test_minimal(self):
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        assert org.voice_definitions == {}
        assert org.prohibited_framings == []


class TestProfileHierarchy:
    def test_minimal(self):
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        ph = ProfileHierarchy(hierarchy_id="h1", org_profile=org)
        assert ph.version == "0.1.0"
        assert ph.departments == {}
        assert ph.people == {}


# --- Template loading ---


class TestDomainTemplates:
    def test_templates_exist(self):
        """All 4 domain template YAML files exist and are loadable."""
        from pathlib import Path

        import yaml

        templates_dir = (
            Path(__file__).parent.parent.parent
            / "joyus_profile"
            / "profile"
            / "templates"
        )
        expected = ["legal_advocacy.yaml", "technical.yaml", "marketing.yaml", "general.yaml"]
        for name in expected:
            path = templates_dir / name
            assert path.exists(), f"Missing template: {name}"
            data = yaml.safe_load(path.read_text())
            assert "domain" in data, f"Template {name} missing 'domain' key"
            assert "section_weights" in data, f"Template {name} missing 'section_weights'"


# --- Fixture loading ---


class TestFixtures:
    def test_fixture_documents_exist(self, fixtures_dir):
        docs = list(fixtures_dir.glob("doc_*.txt"))
        assert len(docs) == 5

    def test_fixture_documents_nonempty(self, fixtures_dir):
        for doc in sorted(fixtures_dir.glob("doc_*.txt")):
            text = doc.read_text()
            assert len(text) > 50, f"{doc.name} is too short"

    def test_sample_documents_fixture(self, sample_documents):
        assert len(sample_documents) == 5
        for doc in sample_documents:
            assert doc.doc_id.startswith("doc_")
            assert doc.metadata.word_count > 0

    def test_sample_corpus_fixture(self, sample_corpus):
        assert sample_corpus.total_documents == 5
        assert sample_corpus.total_words > 0

    def test_sample_profile_fixture(self, sample_profile):
        assert sample_profile.author_name == "Test Author"
        assert sample_profile.voice.formality == 7.5
