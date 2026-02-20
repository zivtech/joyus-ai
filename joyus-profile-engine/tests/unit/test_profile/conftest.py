"""Fixtures for profile generation tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from joyus_profile.ingest.loader import CorpusLoader
from joyus_profile.ingest.preprocessor import Preprocessor
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus


FIXTURES_DIR = Path(__file__).parent.parent.parent.parent / "fixtures" / "example"


@pytest.fixture(scope="module")
def analysis_corpus() -> ProcessedCorpus:
    """Load and preprocess the example fixture corpus."""
    loader = CorpusLoader()
    corpus = loader.load_directory(str(FIXTURES_DIR), formats=[".txt"])
    preprocessor = Preprocessor(min_chunk_words=50, max_chunk_words=500)
    return preprocessor.process(corpus)


@pytest.fixture
def small_corpus() -> ProcessedCorpus:
    """A small synthetic corpus for quick tests."""
    texts = [
        (
            "The regulatory framework requires strict compliance with established guidelines. "
            "Organizations must demonstrate adherence to these standards through regular audits "
            "and comprehensive documentation. Failure to comply may result in enforcement actions."
        ),
        (
            "Furthermore, the commission has determined that additional safeguards are necessary "
            "to protect stakeholders. These measures include enhanced reporting requirements "
            "and periodic review of internal controls and governance structures."
        ),
        (
            "In light of recent developments, we urge the commission to consider the impact "
            "of proposed regulations on smaller entities. A proportional approach would ensure "
            "that compliance obligations do not create undue burden on emerging organizations."
        ),
        (
            "The proposed rule would establish new standards for documentation and record-keeping. "
            "All regulated entities would be required to maintain comprehensive records "
            "and submit periodic reports to the oversight authority for review."
        ),
        (
            "Enforcement proceedings have demonstrated the importance of clear regulatory guidance. "
            "When organizations understand their obligations, compliance rates improve significantly. "
            "We recommend that the commission issue supplementary guidance on implementation."
        ),
    ]
    docs = []
    for i, text in enumerate(texts):
        docs.append(
            Document(
                doc_id=f"synth_{i:03d}",
                text=text,
                metadata=DocumentMetadata(word_count=len(text.split()), author="Author A"),
            )
        )
    corpus = Corpus(
        documents=docs,
        total_words=sum(d.metadata.word_count for d in docs),
        total_documents=len(docs),
    )
    preprocessor = Preprocessor(min_chunk_words=10, max_chunk_words=500)
    return preprocessor.process(corpus)
