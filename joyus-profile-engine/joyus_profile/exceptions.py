"""Custom exceptions for the profile engine."""

from __future__ import annotations


class ProfileEngineError(Exception):
    """Base exception for all profile engine errors."""


class CorpusError(ProfileEngineError):
    """Error during corpus loading or processing."""


class InsufficientCorpusError(CorpusError):
    """Raised when a corpus has fewer documents than the minimum threshold."""

    def __init__(self, count: int, minimum: int = 5) -> None:
        self.count = count
        self.minimum = minimum
        super().__init__(
            f"Corpus has {count} document(s), minimum {minimum} required "
            f"for reliable profiling"
        )


class FormatExtractionError(CorpusError):
    """Error extracting text from a specific file format."""

    def __init__(self, path: str, format_name: str, reason: str) -> None:
        self.path = path
        self.format_name = format_name
        super().__init__(f"Failed to extract {format_name} from {path}: {reason}")
