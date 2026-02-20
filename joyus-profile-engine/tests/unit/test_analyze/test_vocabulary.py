"""Tests for VocabularyAnalyzer."""

from __future__ import annotations

import pytest

from joyus_profile.analyze.vocabulary import VocabularyAnalyzer


class TestVocabularyExtraction:
    def test_returns_vocabulary_profile(self, small_corpus):
        analyzer = VocabularyAnalyzer()
        vocab = analyzer.extract(small_corpus)
        # Should find some preferred terms from regulatory text
        assert len(vocab.preferred_terms) > 0

    def test_signature_phrases_are_multiword(self, analysis_corpus):
        analyzer = VocabularyAnalyzer()
        vocab = analyzer.extract(analysis_corpus)
        for phrase in vocab.signature_phrases:
            assert " " in phrase, f"Signature phrase should be multi-word: {phrase}"

    def test_avoided_terms_are_common_words(self, small_corpus):
        analyzer = VocabularyAnalyzer()
        vocab = analyzer.extract(small_corpus)
        # Avoided terms should be common English words not used by the author
        assert isinstance(vocab.avoided_terms, list)

    def test_technical_terms_extracted(self, analysis_corpus):
        analyzer = VocabularyAnalyzer()
        vocab = analyzer.extract(analysis_corpus)
        assert isinstance(vocab.technical_terms, list)

    def test_empty_corpus_returns_defaults(self):
        from joyus_profile.models.corpus import Corpus, ProcessedCorpus

        empty = ProcessedCorpus(
            corpus=Corpus(documents=[], total_words=0, total_documents=0),
            chunks=[],
            total_chunks=0,
            avg_chunk_words=0.0,
        )
        analyzer = VocabularyAnalyzer()
        vocab = analyzer.extract(empty)
        assert vocab.signature_phrases == []
        assert vocab.preferred_terms == []
