"""Tests for AudienceAnalyzer."""

from __future__ import annotations

import pytest

from joyus_profile.analyze.audience import AudienceAnalyzer
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus


class TestAudienceExtraction:
    def test_returns_audience_profile(self, small_corpus):
        analyzer = AudienceAnalyzer()
        profile = analyzer.extract(small_corpus)
        assert profile.primary_register in (
            "formal", "professional", "neutral", "conversational", "informal"
        )
        assert 0.0 <= profile.formality_score <= 10.0

    def test_formal_text_scores_high(self):
        """Formal regulatory text should score high on formality."""
        formal_text = (
            "Notwithstanding the foregoing provisions, the commission hereby determines "
            "that pursuant to applicable statutes and regulations, enforcement proceedings "
            "shall be instituted. Furthermore, all regulated entities are directed to comply "
            "with the amended requirements within the prescribed timeframe. Accordingly, "
            "failure to demonstrate compliance shall result in appropriate sanctions."
        )
        corpus = _make_single_doc_corpus(formal_text)
        analyzer = AudienceAnalyzer()
        profile = analyzer.extract(corpus)
        assert profile.formality_score >= 6.0

    def test_informal_text_scores_low(self):
        """Casual text should score low on formality."""
        informal_text = (
            "Hey everyone, basically this stuff is pretty cool. "
            "We wanna make things super easy for people. "
            "It's kinda awesome how simple this really is. "
            "Yeah, we literally just need to do the thing. "
            "Ok so the deal is pretty straightforward actually."
        )
        corpus = _make_single_doc_corpus(informal_text)
        analyzer = AudienceAnalyzer()
        profile = analyzer.extract(corpus)
        assert profile.formality_score <= 5.0

    def test_audience_detection(self, small_corpus):
        analyzer = AudienceAnalyzer()
        profile = analyzer.extract(small_corpus)
        # Regulatory corpus should detect regulators audience
        assert isinstance(profile.detected_audiences, list)

    def test_empty_corpus(self):
        empty = ProcessedCorpus(
            corpus=Corpus(documents=[], total_words=0, total_documents=0),
            chunks=[],
            total_chunks=0,
            avg_chunk_words=0.0,
        )
        analyzer = AudienceAnalyzer()
        profile = analyzer.extract(empty)
        assert profile.primary_register == "neutral"
        assert profile.formality_score == 5.0


def _make_single_doc_corpus(text: str) -> ProcessedCorpus:
    """Helper to create a ProcessedCorpus from a single text."""
    doc = Document(
        doc_id="test_001",
        text=text,
        metadata=DocumentMetadata(word_count=len(text.split())),
    )
    corpus = Corpus(
        documents=[doc],
        total_words=doc.metadata.word_count,
        total_documents=1,
    )
    return ProcessedCorpus(
        corpus=corpus,
        chunks=[],
        total_chunks=0,
        avg_chunk_words=0.0,
    )
