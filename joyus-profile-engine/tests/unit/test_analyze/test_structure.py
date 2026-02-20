"""Tests for StructureAnalyzer."""

from __future__ import annotations

import pytest

from joyus_profile.analyze.structure import StructureAnalyzer
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus


class TestStructureExtraction:
    def test_returns_structural_patterns(self, small_corpus):
        analyzer = StructureAnalyzer()
        patterns = analyzer.extract(small_corpus)
        assert patterns.avg_paragraph_length > 0
        assert patterns.avg_paragraphs_per_doc > 0

    def test_heading_detection(self):
        analyzer = StructureAnalyzer()
        assert analyzer._is_heading("# Introduction")
        assert analyzer._is_heading("1. Background")
        assert analyzer._is_heading("CONCLUSION")
        assert not analyzer._is_heading("This is a regular sentence with many words in it.")

    def test_list_item_detection(self):
        analyzer = StructureAnalyzer()
        assert analyzer._is_list_item("- Item one")
        assert analyzer._is_list_item("* Another item")
        assert analyzer._is_list_item("(a) First point")
        assert not analyzer._is_list_item("Regular text here")

    def test_citation_counting(self):
        analyzer = StructureAnalyzer()
        text = "As noted in (2024), the ruling in 123 U.S. 456 established precedent. See also [1]."
        count = analyzer._count_citations(text)
        assert count >= 3  # (2024), U.S. cite, see also, [1]

    def test_empty_corpus(self):
        empty = ProcessedCorpus(
            corpus=Corpus(documents=[], total_words=0, total_documents=0),
            chunks=[],
            total_chunks=0,
            avg_chunk_words=0.0,
        )
        analyzer = StructureAnalyzer()
        patterns = analyzer.extract(empty)
        assert patterns.avg_paragraph_length == 0.0

    def test_from_fixtures(self, analysis_corpus):
        analyzer = StructureAnalyzer()
        patterns = analyzer.extract(analysis_corpus)
        assert patterns.avg_paragraph_length > 0
        assert patterns.citation_density >= 0
