"""Tests for format-specific text extractors."""

from __future__ import annotations

from pathlib import Path

import pytest

from joyus_profile.exceptions import FormatExtractionError
from joyus_profile.ingest.formats import (
    detect_format,
    extract_html,
    extract_markdown,
    extract_text,
    extract_text_file,
)
from joyus_profile.models.corpus import DocumentFormat


class TestDetectFormat:
    def test_txt(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.txt")) == DocumentFormat.TEXT

    def test_pdf(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.pdf")) == DocumentFormat.PDF

    def test_docx(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.docx")) == DocumentFormat.DOCX

    def test_html(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.html")) == DocumentFormat.HTML

    def test_htm(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.htm")) == DocumentFormat.HTML

    def test_md(self, tmp_path: Path):
        assert detect_format(str(tmp_path / "file.md")) == DocumentFormat.MARKDOWN

    def test_unsupported_raises(self, tmp_path: Path):
        with pytest.raises(FormatExtractionError):
            detect_format(str(tmp_path / "file.xyz"))


class TestExtractTextFile:
    def test_reads_plain_text(self, tmp_path: Path):
        f = tmp_path / "test.txt"
        f.write_text("Hello world\nSecond line")
        result = extract_text_file(str(f))
        assert result == "Hello world\nSecond line"

    def test_normalizes_crlf(self, tmp_path: Path):
        f = tmp_path / "test.txt"
        f.write_bytes(b"Line one\r\nLine two\r\n")
        result = extract_text_file(str(f))
        assert "\r" not in result
        assert "Line one\nLine two" == result


class TestExtractMarkdown:
    def test_strips_headers(self, ingest_fixtures: Path):
        result = extract_markdown(str(ingest_fixtures / "article.md"))
        assert "# Sample Article" not in result
        assert "## Section One" not in result
        assert "Sample Article" in result

    def test_strips_bold_italic(self, ingest_fixtures: Path):
        result = extract_markdown(str(ingest_fixtures / "article.md"))
        assert "**bold**" not in result
        assert "bold" in result
        assert "*italic*" not in result
        assert "italic" in result

    def test_strips_links(self, ingest_fixtures: Path):
        result = extract_markdown(str(ingest_fixtures / "article.md"))
        assert "[a link]" not in result
        assert "https://example.com" not in result
        assert "a link" in result

    def test_strips_inline_code(self, ingest_fixtures: Path):
        result = extract_markdown(str(ingest_fixtures / "article.md"))
        assert "`inline code`" not in result
        assert "inline code" in result


class TestExtractHtml:
    def test_extracts_article_content(self, ingest_fixtures: Path):
        result = extract_html(str(ingest_fixtures / "page.html"))
        assert "main content" in result.lower() or "Main Article" in result

    def test_handles_raw_html_string(self):
        html = "<html><body><p>Hello from HTML</p></body></html>"
        result = extract_html(html)
        assert "Hello from HTML" in result


class TestExtractPdf:
    def test_extracts_pdf_text(self, pdf_fixture: Path):
        result = extract_text(str(pdf_fixture), DocumentFormat.PDF)
        assert "test PDF document" in result

    def test_nonexistent_raises(self, tmp_path: Path):
        with pytest.raises(FormatExtractionError):
            extract_text(str(tmp_path / "missing.pdf"), DocumentFormat.PDF)


class TestExtractDocx:
    def test_extracts_docx_text(self, docx_fixture: Path):
        result = extract_text(str(docx_fixture), DocumentFormat.DOCX)
        assert "test DOCX document" in result
        assert "two paragraphs" in result


class TestExtractTextDispatch:
    def test_auto_detects_format(self, ingest_fixtures: Path):
        result = extract_text(str(ingest_fixtures / "doc_01.txt"))
        assert "Document 1 content" in result

    def test_auto_detects_markdown(self, ingest_fixtures: Path):
        result = extract_text(str(ingest_fixtures / "article.md"))
        assert "Sample Article" in result
