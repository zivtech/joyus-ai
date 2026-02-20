"""Shared test fixtures for the profile engine test suite."""

from __future__ import annotations

import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from joyus_profile.models import (
    AuthorProfile,
    Corpus,
    Document,
    DocumentMetadata,
    Marker,
    MarkerSet,
    ProcessedCorpus,
    VocabularyProfile,
    VoiceContext,
    VoiceProfile,
)

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "example"


@pytest.fixture
def fixtures_dir() -> Path:
    """Path to the example fixtures directory."""
    return FIXTURES_DIR


@pytest.fixture
def sample_documents() -> list[Document]:
    """Load sample documents from fixtures."""
    docs = []
    for i, path in enumerate(sorted(FIXTURES_DIR.glob("doc_*.txt")), start=1):
        text = path.read_text()
        docs.append(
            Document(
                doc_id=f"doc_{i:03d}",
                text=text,
                metadata=DocumentMetadata(
                    source_path=str(path),
                    title=f"Sample Document {i}",
                    word_count=len(text.split()),
                ),
            )
        )
    return docs


@pytest.fixture
def sample_corpus(sample_documents: list[Document]) -> Corpus:
    """A corpus built from sample documents."""
    total_words = sum(d.metadata.word_count for d in sample_documents)
    return Corpus(
        documents=sample_documents,
        total_words=total_words,
        total_documents=len(sample_documents),
    )


@pytest.fixture
def processed_corpus(sample_corpus: Corpus) -> ProcessedCorpus:
    """A pre-processed version of the sample corpus (no chunking applied)."""
    return ProcessedCorpus(
        corpus=sample_corpus,
        chunks=[],
        total_chunks=0,
        avg_chunk_words=0.0,
    )


@pytest.fixture
def sample_profile() -> AuthorProfile:
    """A minimal valid AuthorProfile for testing."""
    return AuthorProfile(
        profile_id="test_profile_001",
        author_name="Test Author",
        domain="legal_advocacy",
        corpus_size=5,
        word_count=2500,
        fidelity_tier=2,
        confidence=0.75,
        created_at=datetime(2026, 1, 15),
        updated_at=datetime(2026, 1, 15),
        voice=VoiceProfile(
            formality=7.5,
            emotion=3.0,
            directness=8.0,
            complexity=7.0,
            tone_descriptors=["formal", "authoritative", "precise"],
        ),
        vocabulary=VocabularyProfile(
            signature_phrases=["we urge the commission", "constitutes a violation"],
            preferred_terms=["regulation", "enforcement", "compliance"],
            avoided_terms=["customer", "client"],
            technical_terms=["statute", "rulemaking", "adjudication"],
        ),
        markers=MarkerSet(
            high_signal=[
                Marker(text="we urge the commission", weight=0.9, frequency=0.15),
                Marker(text="constitutes a violation", weight=0.85, frequency=0.1),
            ],
            medium_signal=[
                Marker(text="regulatory framework", weight=0.6, frequency=0.08),
            ],
            negative_markers=[
                Marker(text="we believe that", weight=0.3, frequency=0.0),
            ],
        ),
    )


@pytest.fixture
def sample_voice_context() -> VoiceContext:
    """A sample voice context for multi-audience testing."""
    return VoiceContext(
        voice_id="voice_formal_001",
        audience_key="formal",
        audience_label="Formal (Regulatory)",
        description="Voice used for formal regulatory communications",
        fidelity_tier=2,
        corpus_size_for_voice=5000,
        voice_override=VoiceProfile(
            formality=6.0,
            emotion=6.5,
            directness=9.0,
            complexity=5.0,
            tone_descriptors=["passionate", "accessible", "urgent"],
        ),
    )


@pytest.fixture
def tmp_output_dir(tmp_path: Path) -> Path:
    """Temporary directory for skill file output."""
    output = tmp_path / "skill_output"
    output.mkdir()
    return output
