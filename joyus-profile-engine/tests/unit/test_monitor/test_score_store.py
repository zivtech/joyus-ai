"""Tests for ScoreStore: append, read, filter, atomic writes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from joyus_profile.monitor.score_store import ScoreStore

from .conftest import PROFILE_ID, make_score


class TestAppend:
    def test_append_creates_directory_and_file(self, score_store: ScoreStore):
        score = make_score()
        score_store.append(PROFILE_ID, score)

        path = Path(score_store.data_dir) / PROFILE_ID / "scores.json"
        assert path.exists()

    def test_append_adds_to_existing(self, score_store: ScoreStore):
        score_store.append(PROFILE_ID, make_score(score=0.8))
        score_store.append(PROFILE_ID, make_score(score=0.9))

        scores = score_store.get_scores(PROFILE_ID)
        assert len(scores) == 2

    def test_append_preserves_existing_data(self, score_store: ScoreStore):
        score_store.append(PROFILE_ID, make_score(score=0.75))
        score_store.append(PROFILE_ID, make_score(score=0.85))

        scores = score_store.get_scores(PROFILE_ID)
        assert scores[0].score == 0.75
        assert scores[1].score == 0.85

    def test_atomic_write_no_tmp_left(self, score_store: ScoreStore):
        score_store.append(PROFILE_ID, make_score())

        tmp_path = Path(score_store.data_dir) / PROFILE_ID / "scores.tmp"
        assert not tmp_path.exists()


class TestGetScores:
    def test_empty_profile_returns_empty(self, score_store: ScoreStore):
        scores = score_store.get_scores("nonexistent_profile")
        assert scores == []

    def test_returns_all_scores(self, score_store: ScoreStore):
        for i in range(5):
            score_store.append(PROFILE_ID, make_score(score=0.5 + i * 0.1))

        scores = score_store.get_scores(PROFILE_ID)
        assert len(scores) == 5

    def test_filter_by_window_start(self, score_store: ScoreStore):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=10)
        recent = now - timedelta(hours=1)

        score_store.append(PROFILE_ID, make_score(score=0.6, timestamp=old))
        score_store.append(PROFILE_ID, make_score(score=0.9, timestamp=recent))

        cutoff = now - timedelta(days=1)
        scores = score_store.get_scores(PROFILE_ID, window_start=cutoff)
        assert len(scores) == 1
        assert scores[0].score == 0.9

    def test_filter_by_window_end(self, score_store: ScoreStore):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=10)
        recent = now - timedelta(hours=1)

        score_store.append(PROFILE_ID, make_score(score=0.6, timestamp=old))
        score_store.append(PROFILE_ID, make_score(score=0.9, timestamp=recent))

        cutoff = now - timedelta(days=5)
        scores = score_store.get_scores(PROFILE_ID, window_end=cutoff)
        assert len(scores) == 1
        assert scores[0].score == 0.6

    def test_filter_by_both_windows(self, score_store: ScoreStore):
        now = datetime.now(timezone.utc)
        timestamps = [now - timedelta(days=d) for d in [20, 10, 5, 1]]
        for i, ts in enumerate(timestamps):
            score_store.append(PROFILE_ID, make_score(score=0.5 + i * 0.1, timestamp=ts))

        scores = score_store.get_scores(
            PROFILE_ID,
            window_start=now - timedelta(days=12),
            window_end=now - timedelta(days=3),
        )
        assert len(scores) == 2


class TestGetLatest:
    def test_returns_most_recent(self, score_store: ScoreStore):
        now = datetime.now(timezone.utc)
        for i in range(5):
            ts = now - timedelta(hours=5 - i)
            score_store.append(PROFILE_ID, make_score(score=0.5 + i * 0.1, timestamp=ts))

        latest = score_store.get_latest(PROFILE_ID, n=3)
        assert len(latest) == 3
        # Most recent first (descending)
        assert latest[0].timestamp >= latest[1].timestamp
        assert latest[1].timestamp >= latest[2].timestamp

    def test_returns_all_when_fewer_than_n(self, score_store: ScoreStore):
        score_store.append(PROFILE_ID, make_score())
        score_store.append(PROFILE_ID, make_score())

        latest = score_store.get_latest(PROFILE_ID, n=10)
        assert len(latest) == 2

    def test_empty_profile_returns_empty(self, score_store: ScoreStore):
        latest = score_store.get_latest("no_such_profile")
        assert latest == []
