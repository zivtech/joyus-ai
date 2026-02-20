"""Monitoring pipeline: queue and process Tier 2 deep analysis."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone

from cuid2 import cuid_wrapper

from joyus_profile.models.monitoring import DriftSignal, MonitoringJob, MonitoringResult
from joyus_profile.models.verification import FidelityScore
from joyus_profile.monitor.alerts import AlertGenerator
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.score_store import ScoreStore

_cuid = cuid_wrapper()


class MonitoringPipeline:
    """Queue-based Tier 2 analysis pipeline.

    The pipeline is synchronous internally.  It is designed to be called
    from ``asyncio.to_thread()`` by the MCP layer.
    """

    def __init__(
        self,
        score_store: ScoreStore,
        drift_detector: DriftDetector,
        alert_generator: AlertGenerator | None = None,
        *,
        scorer: _FidelityScorer | None = None,
    ) -> None:
        self.score_store = score_store
        self.drift_detector = drift_detector
        self.alert_generator = alert_generator
        self._scorer = scorer or _FidelityScorer()
        self._queue: deque[MonitoringJob] = deque()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enqueue(
        self,
        content: str,
        profile_id: str,
        voice_key: str | None = None,
    ) -> str:
        """Queue content for Tier 2 analysis. Returns the job_id."""
        job = MonitoringJob(
            job_id=_cuid(),
            content=content,
            profile_id=profile_id,
            voice_key=voice_key,
            queued_at=datetime.now(timezone.utc),
        )
        self._queue.append(job)
        return job.job_id

    def process_next(self) -> MonitoringResult | None:
        """Process one queued job: score, store, drift-check."""
        if not self._queue:
            return None

        job = self._queue.popleft()

        # 1. Run Tier 2 deep analysis
        fidelity = self._scorer.score(job.content)

        # 2. Store the score
        self.score_store.append(job.profile_id, fidelity)

        # 3. Check for drift signals
        signals: list[DriftSignal] = self.drift_detector.check(job.profile_id)

        # 4. Generate alerts if drift detected
        if signals and self.alert_generator is not None:
            self.alert_generator.generate_alerts(job.profile_id, signals)

        return MonitoringResult(
            job_id=job.job_id,
            score=fidelity.score,
            marker_score=fidelity.marker_score,
            style_score=fidelity.style_score,
            feature_breakdown=fidelity.feature_breakdown,
            feedback=fidelity.feedback,
            passed=fidelity.passed,
            drift_signals=signals,
            processed_at=datetime.now(timezone.utc),
        )

    def process_all(self) -> list[MonitoringResult]:
        """Drain the queue, processing every job."""
        results: list[MonitoringResult] = []
        while self._queue:
            result = self.process_next()
            if result is not None:
                results.append(result)
        return results

    @property
    def pending_count(self) -> int:
        """Number of jobs still in the queue."""
        return len(self._queue)


# ------------------------------------------------------------------
# Default scorer (placeholder for actual Tier 2 implementation)
# ------------------------------------------------------------------


class _FidelityScorer:
    """Minimal Tier 2 scorer.

    The real scorer would run Burrows' Delta, marker extraction, etc.
    This default implementation produces a neutral passing score so the
    pipeline can operate end-to-end without requiring the full analysis
    stack.  Callers can inject a real scorer via the *scorer* parameter.
    """

    def score(self, content: str) -> FidelityScore:
        word_count = len(content.split())
        # Simple heuristic: longer content gets a slightly higher base score
        base = min(0.85, 0.5 + word_count * 0.001)
        return FidelityScore(
            score=round(base, 4),
            passed=base >= 0.6,
            tier=2,
            marker_score=0.0,
            style_score=0.0,
            feature_breakdown={},
            feedback=None,
            timestamp=datetime.now(timezone.utc),
        )
