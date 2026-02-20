"""Fixtures for emit tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from joyus_profile.ingest.loader import CorpusLoader
from joyus_profile.ingest.preprocessor import Preprocessor
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus
from joyus_profile.profile.generator import ProfileGenerator


FIXTURES_DIR = Path(__file__).parent.parent.parent.parent / "fixtures" / "example"


@pytest.fixture(scope="module")
def sample_profile():
    """Build a profile from the example fixtures for emit tests."""
    loader = CorpusLoader()
    corpus = loader.load_directory(str(FIXTURES_DIR), formats=[".txt"])
    preprocessor = Preprocessor(min_chunk_words=50, max_chunk_words=500)
    processed = preprocessor.process(corpus)
    gen = ProfileGenerator(domain="general")
    return gen.build(processed, "Test Author")
