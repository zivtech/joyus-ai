"""Tests for MonitoringPipeline: enqueue, process, drain."""

from __future__ import annotations

from joyus_profile.monitor.pipeline import MonitoringPipeline

from .conftest import PROFILE_ID


class TestEnqueue:
    def test_enqueue_returns_job_id(self, pipeline: MonitoringPipeline):
        job_id = pipeline.enqueue("Some content to analyze.", PROFILE_ID)
        assert isinstance(job_id, str)
        assert len(job_id) > 0

    def test_enqueue_increments_pending(self, pipeline: MonitoringPipeline):
        assert pipeline.pending_count == 0
        pipeline.enqueue("Content one.", PROFILE_ID)
        assert pipeline.pending_count == 1
        pipeline.enqueue("Content two.", PROFILE_ID)
        assert pipeline.pending_count == 2

    def test_enqueue_with_voice_key(self, pipeline: MonitoringPipeline):
        job_id = pipeline.enqueue("Content.", PROFILE_ID, voice_key="formal")
        assert isinstance(job_id, str)


class TestProcessNext:
    def test_empty_queue_returns_none(self, pipeline: MonitoringPipeline):
        result = pipeline.process_next()
        assert result is None

    def test_process_returns_result(self, pipeline: MonitoringPipeline):
        pipeline.enqueue("This is a test document for analysis.", PROFILE_ID)
        result = pipeline.process_next()

        assert result is not None
        assert result.job_id
        assert isinstance(result.score, float)
        assert result.passed is True or result.passed is False

    def test_process_decrements_pending(self, pipeline: MonitoringPipeline):
        pipeline.enqueue("Content.", PROFILE_ID)
        assert pipeline.pending_count == 1
        pipeline.process_next()
        assert pipeline.pending_count == 0

    def test_process_stores_score(self, pipeline: MonitoringPipeline, score_store):
        pipeline.enqueue("Content for scoring.", PROFILE_ID)
        pipeline.process_next()

        scores = score_store.get_scores(PROFILE_ID)
        assert len(scores) == 1

    def test_process_checks_drift(self, pipeline: MonitoringPipeline):
        pipeline.enqueue("Content.", PROFILE_ID)
        result = pipeline.process_next()
        # With only 1 score, drift detector returns empty (min_samples=5)
        assert result is not None
        assert result.drift_signals == []


class TestProcessAll:
    def test_process_all_drains_queue(self, pipeline: MonitoringPipeline):
        for i in range(5):
            pipeline.enqueue(f"Content number {i}.", PROFILE_ID)

        assert pipeline.pending_count == 5
        results = pipeline.process_all()
        assert len(results) == 5
        assert pipeline.pending_count == 0

    def test_process_all_empty_queue(self, pipeline: MonitoringPipeline):
        results = pipeline.process_all()
        assert results == []

    def test_process_all_stores_all_scores(
        self, pipeline: MonitoringPipeline, score_store
    ):
        for i in range(3):
            pipeline.enqueue(f"Content {i}.", PROFILE_ID)

        pipeline.process_all()
        scores = score_store.get_scores(PROFILE_ID)
        assert len(scores) == 3
