"""Tests for RollupEngine: daily/weekly aggregation and trend slope."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from joyus_profile.monitor.rollups import RollupEngine

from .conftest import PROFILE_ID, make_score


class TestComputeDaily:
    def test_daily_with_scores(self, rollup_engine: RollupEngine, score_store):
        today = date.today()
        ts = datetime.combine(today, time(12, 0), tzinfo=timezone.utc)

        score_store.append(PROFILE_ID, make_score(score=0.8, timestamp=ts))
        score_store.append(
            PROFILE_ID,
            make_score(score=0.9, timestamp=ts + timedelta(hours=1)),
        )

        rollup = rollup_engine.compute_daily(PROFILE_ID, today)

        assert rollup.count == 2
        assert rollup.mean is not None
        assert abs(rollup.mean - 0.85) < 0.01
        assert rollup.min == 0.8
        assert rollup.max == 0.9

    def test_daily_no_scores(self, rollup_engine: RollupEngine):
        rollup = rollup_engine.compute_daily(PROFILE_ID, date.today())
        assert rollup.count == 0
        assert rollup.mean is None
        assert rollup.std is None

    def test_daily_single_score_zero_std(self, rollup_engine: RollupEngine, score_store):
        today = date.today()
        ts = datetime.combine(today, time(10, 0), tzinfo=timezone.utc)
        score_store.append(PROFILE_ID, make_score(score=0.75, timestamp=ts))

        rollup = rollup_engine.compute_daily(PROFILE_ID, today)
        assert rollup.count == 1
        assert rollup.std == 0.0


class TestComputeWeekly:
    def test_weekly_aggregates_daily(self, rollup_engine: RollupEngine, score_store):
        monday = date.today() - timedelta(days=date.today().weekday())

        for offset in range(5):  # Mon-Fri
            day = monday + timedelta(days=offset)
            ts = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
            score_store.append(
                PROFILE_ID, make_score(score=0.7 + offset * 0.05, timestamp=ts)
            )

        weekly = rollup_engine.compute_weekly(PROFILE_ID, monday)
        assert weekly.count == 5
        assert weekly.mean is not None
        assert len(weekly.daily_rollups) == 5

    def test_weekly_empty_days_skipped(self, rollup_engine: RollupEngine, score_store):
        monday = date.today() - timedelta(days=date.today().weekday())
        ts = datetime.combine(monday, time(12, 0), tzinfo=timezone.utc)
        score_store.append(PROFILE_ID, make_score(score=0.8, timestamp=ts))

        weekly = rollup_engine.compute_weekly(PROFILE_ID, monday)
        assert weekly.count == 1
        assert len(weekly.daily_rollups) == 1  # Only 1 day has data

    def test_weekly_no_data(self, rollup_engine: RollupEngine):
        monday = date(2025, 1, 6)
        weekly = rollup_engine.compute_weekly(PROFILE_ID, monday)
        assert weekly.count == 0
        assert weekly.mean is None


class TestGetTrend:
    def test_trend_declining_slope(self, rollup_engine: RollupEngine, score_store):
        """Scores declining over time should produce a negative slope."""
        today = date.today()
        for i in range(10):
            day = today - timedelta(days=10 - i)
            ts = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
            # Scores decrease from 0.9 to 0.45
            score_store.append(
                PROFILE_ID, make_score(score=0.9 - i * 0.05, timestamp=ts)
            )

        trend = rollup_engine.get_trend(PROFILE_ID, window_days=15)
        assert trend.trend_slope is not None
        assert trend.trend_slope < 0  # Declining

    def test_trend_improving_slope(self, rollup_engine: RollupEngine, score_store):
        """Scores improving over time should produce a positive slope."""
        today = date.today()
        for i in range(10):
            day = today - timedelta(days=10 - i)
            ts = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
            score_store.append(
                PROFILE_ID, make_score(score=0.5 + i * 0.04, timestamp=ts)
            )

        trend = rollup_engine.get_trend(PROFILE_ID, window_days=15)
        assert trend.trend_slope is not None
        assert trend.trend_slope > 0  # Improving

    def test_trend_no_data(self, rollup_engine: RollupEngine):
        trend = rollup_engine.get_trend(PROFILE_ID, window_days=7)
        assert trend.sample_count == 0
        assert trend.trend_slope is None

    def test_trend_single_day(self, rollup_engine: RollupEngine, score_store):
        today = date.today()
        ts = datetime.combine(today, time(12, 0), tzinfo=timezone.utc)
        score_store.append(PROFILE_ID, make_score(score=0.8, timestamp=ts))

        trend = rollup_engine.get_trend(PROFILE_ID, window_days=7)
        assert trend.sample_count == 1
        # Single data point cannot produce a slope
        assert trend.trend_slope is None

    def test_trend_weekly_granularity(self, rollup_engine: RollupEngine, score_store):
        today = date.today()
        for i in range(14):
            day = today - timedelta(days=14 - i)
            ts = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
            score_store.append(PROFILE_ID, make_score(score=0.8, timestamp=ts))

        trend = rollup_engine.get_trend(
            PROFILE_ID, window_days=20, granularity="weekly"
        )
        assert len(trend.weekly_rollups) > 0
