"""Format-specific text extractors for document ingestion."""

from __future__ import annotations

import re
from pathlib import Path

from joyus_profile.exceptions import FormatExtractionError
from joyus_profile.models.corpus import DocumentFormat


def extract_pdf(path: str) -> str:
    """Extract text from a PDF file using PyMuPDF.

    Only handles text-based PDFs; scanned/image PDFs will return minimal text.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise FormatExtractionError(path, "PDF", "PyMuPDF (fitz) not installed") from exc

    try:
        doc = fitz.open(path)
        pages = [page.get_text() for page in doc]
        doc.close()
        return "\n\n".join(pages).strip()
    except Exception as exc:
        raise FormatExtractionError(path, "PDF", str(exc)) from exc


def extract_docx(path: str) -> str:
    """Extract text from a DOCX file using python-docx."""
    try:
        from docx import Document as DocxDocument
    except ImportError as exc:
        raise FormatExtractionError(path, "DOCX", "python-docx not installed") from exc

    try:
        doc = DocxDocument(path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as exc:
        raise FormatExtractionError(path, "DOCX", str(exc)) from exc


def extract_html(path_or_content: str) -> str:
    """Extract text from HTML using trafilatura with BeautifulSoup fallback."""
    content = path_or_content
    if Path(path_or_content).is_file():
        content = Path(path_or_content).read_text(encoding="utf-8")

    try:
        import trafilatura

        result = trafilatura.extract(content)
        if result:
            return result.strip()
    except Exception:
        pass

    # Fallback to BeautifulSoup
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(content, "html.parser")
        # Remove script and style elements
        for element in soup(["script", "style", "nav", "header", "footer"]):
            element.decompose()
        return soup.get_text(separator="\n", strip=True)
    except Exception as exc:
        raise FormatExtractionError(
            path_or_content, "HTML", str(exc)
        ) from exc


def extract_markdown(path: str) -> str:
    """Extract clean text from a Markdown file by stripping syntax."""
    text = Path(path).read_text(encoding="utf-8")

    # Strip headers
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Strip bold/italic
    text = re.sub(r"\*{1,3}(.+?)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,3}(.+?)_{1,3}", r"\1", text)
    # Strip inline code
    text = re.sub(r"`(.+?)`", r"\1", text)
    # Strip links — keep text, drop URL
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Strip images
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    # Strip blockquotes
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    # Strip horizontal rules
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    # Strip list markers
    text = re.sub(r"^[\s]*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\s]*\d+\.\s+", "", text, flags=re.MULTILINE)

    return text.strip()


def extract_text_file(path: str) -> str:
    """Read a plain text file, normalizing line endings."""
    text = Path(path).read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


# Format dispatch map
_EXTRACTORS: dict[DocumentFormat, callable] = {
    DocumentFormat.PDF: extract_pdf,
    DocumentFormat.DOCX: extract_docx,
    DocumentFormat.HTML: extract_html,
    DocumentFormat.MARKDOWN: extract_markdown,
    DocumentFormat.TEXT: extract_text_file,
}

# Extension to format mapping
EXTENSION_MAP: dict[str, DocumentFormat] = {
    ".pdf": DocumentFormat.PDF,
    ".docx": DocumentFormat.DOCX,
    ".html": DocumentFormat.HTML,
    ".htm": DocumentFormat.HTML,
    ".md": DocumentFormat.MARKDOWN,
    ".markdown": DocumentFormat.MARKDOWN,
    ".txt": DocumentFormat.TEXT,
    ".text": DocumentFormat.TEXT,
}


def detect_format(path: str) -> DocumentFormat:
    """Detect document format from file extension."""
    ext = Path(path).suffix.lower()
    if ext not in EXTENSION_MAP:
        raise FormatExtractionError(path, ext, f"Unsupported file format: {ext}")
    return EXTENSION_MAP[ext]


def extract_text(path: str, fmt: DocumentFormat | None = None) -> str:
    """Extract text from a file, auto-detecting format if not specified."""
    if fmt is None:
        fmt = detect_format(path)
    extractor = _EXTRACTORS.get(fmt)
    if extractor is None:
        raise FormatExtractionError(path, fmt.value, "No extractor available")
    return extractor(path)
