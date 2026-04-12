"""
Typed exceptions for the Checkpoint SDK.

All exceptions inherit from CheckpointError so callers can catch the base
class broadly or individual subclasses for fine-grained handling.
"""


class CheckpointError(Exception):
    """Base exception for all Checkpoint SDK errors."""

    def __init__(self, message: str, status_code: int = None, code: str = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code

    def __repr__(self) -> str:
        return f"{type(self).__name__}(message={str(self)!r}, status_code={self.status_code}, code={self.code!r})"


class AuthError(CheckpointError):
    """Raised on 401 Unauthorized — invalid or missing API key / JWT."""
    pass


class NotFoundError(CheckpointError):
    """Raised on 404 Not Found."""
    pass


class ConflictError(CheckpointError):
    """Raised on 409 Conflict (e.g. ETag mismatch)."""
    pass


class RateLimitError(CheckpointError):
    """Raised on 429 Too Many Requests after all retry attempts are exhausted."""

    def __init__(self, message: str, retry_after: int = None):
        super().__init__(message, status_code=429, code="RATE_LIMITED")
        self.retry_after = retry_after


class ValidationError(CheckpointError):
    """Raised on 400 Bad Request — invalid input data."""
    pass


class PayloadTooLargeError(CheckpointError):
    """Raised on 413 Payload Too Large — state exceeds the 1 MB limit."""
    pass
