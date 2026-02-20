"""Tests for CorpusLoader."""

from __future__ import annotations

from pathlib import Path

import pytest

from joyus_profile.exceptions import CorpusError, InsufficientCorpusError
from joyus_profile.ingest.loader import CorpusLoader


class TestLoadDirectory:
    def test_loads_all_txt_files(self, ingest_fixtures: Path):
        loader = CorpusLoader()
        corpus = loader.load_directory(str(ingest_fixtures), formats=[".txt"])
        assert corpus.total_documents == 5
        assert corpus.total_words > 0
        for doc in corpus.documents:
            assert doc.doc_id  # CUID2 generated
            assert doc.metadata.word_count > 0

    def test_loads_all_supported_formats(self, ingest_fixtures: Path):
        loader = CorpusLoader()
        corpus = loader.load_directory(str(ingest_fixtures))
        # 5 txt + 1 md + 1 html = 7 documents
        assert corpus.total_documents == 7

    def test_nonexistent_directory_raises(self):
        loader = CorpusLoader()
        with pytest.raises(CorpusError, match="Directory not found"):
            loader.load_directory("/nonexistent/path")

    def test_insufficient_documents_raises(self, tmp_path: Path):
        # Create only 2 text files
        for i in range(2):
            (tmp_path / f"doc_{i}.txt").write_text(f"Short document {i}.")
        loader = CorpusLoader()
        with pytest.raises(InsufficientCorpusError) as exc_info:
            loader.load_directory(str(tmp_path))
        assert exc_info.value.count == 2
        assert exc_info.value.minimum == 5

    def test_custom_minimum_documents(self, tmp_path: Path):
        for i in range(3):
            (tmp_path / f"doc_{i}.txt").write_text(f"Short document {i}.")
        loader = CorpusLoader(minimum_documents=3)
        corpus = loader.load_directory(str(tmp_path))
        assert corpus.total_documents == 3


class TestLoadFiles:
    def test_loads_specific_files(self, ingest_fixtures: Path):
        paths = [str(ingest_fixtures / f"doc_{i:02d}.txt") for i in range(1, 6)]
        loader = CorpusLoader()
        corpus = loader.load_files(paths)
        assert corpus.total_documents == 5

    def test_skips_missing_files(self, ingest_fixtures: Path):
        paths = [
            str(ingest_fixtures / "doc_01.txt"),
            str(ingest_fixtures / "missing.txt"),
            str(ingest_fixtures / "doc_02.txt"),
            str(ingest_fixtures / "doc_03.txt"),
            str(ingest_fixtures / "doc_04.txt"),
            str(ingest_fixtures / "doc_05.txt"),
        ]
        loader = CorpusLoader()
        corpus = loader.load_files(paths)
        assert corpus.total_documents == 5


class TestLoadText:
    def test_wraps_raw_text(self):
        loader = CorpusLoader(minimum_documents=1)
        text = "This is raw text content for analysis."
        corpus = loader.load_text(text)
        assert corpus.total_documents == 1
        assert corpus.documents[0].text == text
        assert corpus.documents[0].metadata.word_count == 7

    def test_with_metadata(self):
        loader = CorpusLoader(minimum_documents=1)
        corpus = loader.load_text(
            "Some content here.",
            metadata={"title": "Test Doc", "author": "Author A"},
        )
        assert corpus.documents[0].metadata.title == "Test Doc"
        assert corpus.documents[0].metadata.author == "Author A"

    def test_insufficient_raises_for_single_doc(self):
        loader = CorpusLoader()  # default minimum=5
        with pytest.raises(InsufficientCorpusError):
            loader.load_text("Single document.")
