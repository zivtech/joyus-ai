"""Corpus ingestion: loading, format extraction, and preprocessing."""

from .formats import detect_format, extract_text
from .loader import CorpusLoader
from .preprocessor import Preprocessor

__all__ = [
    "CorpusLoader",
    "Preprocessor",
    "detect_format",
    "extract_text",
]
