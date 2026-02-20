"""Optional Langfuse observability hooks for monitoring traces.

Usage::

    from joyus_profile.monitor.observability import ObservabilityHooks

    hooks = ObservabilityHooks()               # no-op (Langfuse not configured)
    hooks = ObservabilityHooks(langfuse_client) # live tracing

All methods are safe to call regardless of whether Langfuse is installed or
configured — they become no-ops when ``langfuse_client`` is ``None``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

# Langfuse is an optional dependency. Import its type only for static analysis
# so that missing the package does not raise an ImportError at runtime.
try:
    from langfuse import Langfuse as _Langfuse  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    _Langfuse = None  # type: ignore[assignment,misc]

if TYPE_CHECKING:
    from joyus_profile.models.monitoring import DriftSignal, RepairAction
    from joyus_profile.models.verification import FidelityScore


class ObservabilityHooks:
    """Optional Langfuse integration for monitoring traces.

    All methods are no-ops when ``langfuse_client`` is ``None``.
    """

    def __init__(self, langfuse_client: Any = None) -> None:
        self.langfuse = langfuse_client

    # ------------------------------------------------------------------
    # Public trace methods
    # ------------------------------------------------------------------

    def trace_verification(self, profile_id: str, score: "FidelityScore") -> None:
        """Log a verification score to Langfuse.

        Args:
            profile_id: The profile the content was verified against.
            score: The fidelity score produced by the verifier.
        """
        if not self.langfuse:
            return
        self.langfuse.trace(
            name="fidelity_verification",
            metadata={
                "profile_id": profile_id,
                "tier": score.tier,
                "score": score.score,
                "passed": score.passed,
            },
        )

    def trace_drift_check(
        self, profile_id: str, signals: "list[DriftSignal]"
    ) -> None:
        """Log drift detection results to Langfuse.

        Args:
            profile_id: The profile that was checked for drift.
            signals: The drift signals detected (empty list = no drift).
        """
        if not self.langfuse:
            return
        self.langfuse.trace(
            name="drift_check",
            metadata={
                "profile_id": profile_id,
                "signal_count": len(signals),
                "drift_detected": len(signals) > 0,
                "signal_types": [s.signal_type for s in signals],
            },
        )

    def trace_repair(self, action: "RepairAction") -> None:
        """Log repair lifecycle events to Langfuse.

        Args:
            action: The repair action being traced.
        """
        if not self.langfuse:
            return
        self.langfuse.trace(
            name="repair_action",
            metadata={
                "action_id": action.action_id,
                "action_type": action.action_type,
                "status": action.status,
            },
        )
