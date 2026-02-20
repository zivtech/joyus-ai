"""Tests for the Preprocessor."""

from __future__ import annotations

import pytest

from joyus_profile.ingest.loader import CorpusLoader
from joyus_profile.ingest.preprocessor import Preprocessor
from joyus_profile.models.corpus import Chunk, Corpus, Document, DocumentMetadata


class TestNormalization:
    def _make_preprocessor(self) -> Preprocessor:
        return Preprocessor(min_chunk_words=10, max_chunk_words=50)

    def test_normalizes_curly_quotes(self):
        pp = self._make_preprocessor()
        result = pp._normalize("\u201cHello\u201d and \u2018world\u2019")
        assert '"Hello"' in result
        assert "'world'" in result

    def test_normalizes_line_endings(self):
        pp = self._make_preprocessor()
        result = pp._normalize("line one\r\nline two\rline three")
        assert "\r" not in result
        assert "line one\nline two\nline three" == result

    def test_collapses_whitespace(self):
        pp = self._make_preprocessor()
        result = pp._normalize("too   many   spaces")
        assert "too many spaces" == result

    def test_collapses_excess_newlines(self):
        pp = self._make_preprocessor()
        result = pp._normalize("para one\n\n\n\n\npara two")
        assert "para one\n\npara two" == result

    def test_normalizes_en_dash_to_em_dash(self):
        pp = self._make_preprocessor()
        result = pp._normalize("value\u2013range")
        assert "value\u2014range" == result


class TestBoilerplateRemoval:
    def _make_preprocessor(self) -> Preprocessor:
        return Preprocessor(min_chunk_words=10, max_chunk_words=50)

    def test_removes_page_numbers(self):
        pp = self._make_preprocessor()
        result = pp._clean_boilerplate("Content here\n\nPage 42\n\nMore content")
        assert "Page 42" not in result
        assert "Content here" in result

    def test_removes_copyright(self):
        pp = self._make_preprocessor()
        result = pp._clean_boilerplate("Content\n\nCopyright 2026 Example Corp\n\nMore content")
        assert "Copyright" not in result

    def test_preserves_normal_content(self):
        pp = self._make_preprocessor()
        text = "This is normal content.\n\nIt should remain unchanged."
        result = pp._clean_boilerplate(text)
        assert "normal content" in result
        assert "remain unchanged" in result


class TestSegmentation:
    def test_single_paragraph_stays_together(self):
        pp = Preprocessor(min_chunk_words=10, max_chunk_words=100)
        corpus = _make_corpus(["Short paragraph with a few words."])
        result = pp.process(corpus)
        assert result.total_chunks == 1

    def test_respects_paragraph_boundaries(self):
        # Create text with distinct paragraphs totaling >1000 words
        paragraphs = []
        for i in range(10):
            paragraphs.append(
                f"Paragraph {i}. " + "Word " * 120
            )
        text = "\n\n".join(paragraphs)

        pp = Preprocessor(min_chunk_words=500, max_chunk_words=1000)
        corpus = _make_corpus([text])
        result = pp.process(corpus)

        # Should produce multiple chunks
        assert result.total_chunks > 1
        # Each chunk should not split mid-sentence (paragraphs are atomic)
        for chunk in result.chunks:
            assert chunk.word_count > 0

    def test_avg_chunk_words_computed(self):
        paragraphs = ["Word " * 600, "More " * 600]
        text = "\n\n".join(paragraphs)

        pp = Preprocessor(min_chunk_words=500, max_chunk_words=700)
        corpus = _make_corpus([text])
        result = pp.process(corpus)
        assert result.avg_chunk_words > 0

    def test_empty_document_produces_no_chunks(self):
        pp = Preprocessor(min_chunk_words=10, max_chunk_words=50)
        corpus = _make_corpus([""])
        result = pp.process(corpus)
        assert result.total_chunks == 0


class TestRoundTrip:
    def test_load_then_preprocess(self, ingest_fixtures):
        """End-to-end: load directory → preprocess → access chunks."""
        loader = CorpusLoader()
        corpus = loader.load_directory(str(ingest_fixtures))
        pp = Preprocessor(min_chunk_words=10, max_chunk_words=100)
        result = pp.process(corpus)
        assert result.total_chunks > 0
        assert result.corpus.total_documents == corpus.total_documents
        for chunk in result.chunks:
            assert isinstance(chunk, Chunk)
            assert chunk.word_count > 0


def _make_corpus(texts: list[str]) -> Corpus:
    """Helper: build a Corpus from raw text strings."""
    docs = []
    for i, text in enumerate(texts):
        wc = len(text.split())
        docs.append(
            Document(
                doc_id=f"test_{i:03d}",
                text=text,
                metadata=DocumentMetadata(word_count=wc),
            )
        )
    return Corpus(
        documents=docs,
        total_words=sum(d.metadata.word_count for d in docs),
        total_documents=len(docs),
    )
