"""Daily/weekly rollup aggregation and trend analysis."""

from __future__ import annotations

import statistics
from datetime import date, datetime, time, timedelta, timezone

from joyus_profile.models.monitoring import DailyRollup, TrendData, WeeklyRollup
from joyus_profile.monitor.score_store import ScoreStore


class RollupEngine:
    """Aggregate raw fidelity scores into daily and weekly summaries."""

    def __init__(self, score_store: ScoreStore) -> None:
        self.score_store = score_store

    # ------------------------------------------------------------------
    # Daily
    # ------------------------------------------------------------------

    def compute_daily(self, profile_id: str, target_date: date) -> DailyRollup:
        """Aggregate all scores for *profile_id* on *target_date*."""
        scores = self.score_store.get_scores(
            profile_id,
            window_start=datetime.combine(target_date, time.min, tzinfo=timezone.utc),
            window_end=datetime.combine(target_date, time.max, tzinfo=timezone.utc),
        )

        if not scores:
            return DailyRollup(date=target_date, count=0)

        values = [s.score for s in scores]
        return DailyRollup(
            date=target_date,
            count=len(values),
            mean=statistics.mean(values),
            std=statistics.stdev(values) if len(values) > 1 else 0.0,
            min=min(values),
            max=max(values),
        )

    # ------------------------------------------------------------------
    # Weekly
    # ------------------------------------------------------------------

    def compute_weekly(self, profile_id: str, week_start: date) -> WeeklyRollup:
        """Aggregate daily rollups for 7 days starting at *week_start*."""
        week_end = week_start + timedelta(days=6)
        dailies: list[DailyRollup] = []
        for offset in range(7):
            day = week_start + timedelta(days=offset)
            rollup = self.compute_daily(profile_id, day)
            if rollup.count > 0:
                dailies.append(rollup)

        if not dailies:
            return WeeklyRollup(week_start=week_start, week_end=week_end, count=0)

        all_values: list[float] = []
        for d in dailies:
            if d.mean is not None:
                all_values.extend([d.mean] * d.count)

        total_count = sum(d.count for d in dailies)
        return WeeklyRollup(
            week_start=week_start,
            week_end=week_end,
            count=total_count,
            mean=statistics.mean(all_values) if all_values else None,
            std=statistics.stdev(all_values) if len(all_values) > 1 else 0.0,
            min=min(d.min for d in dailies if d.min is not None) if dailies else None,
            max=max(d.max for d in dailies if d.max is not None) if dailies else None,
            daily_rollups=dailies,
        )

    # ------------------------------------------------------------------
    # Trend
    # ------------------------------------------------------------------

    def get_trend(
        self,
        profile_id: str,
        window_days: int = 30,
        granularity: str = "daily",
    ) -> TrendData:
        """Compute trend data including slope via simple linear regression on daily means."""
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=window_days - 1)

        # Compute daily rollups for the window (skip empty days)
        dailies: list[DailyRollup] = []
        for offset in range(window_days):
            day = start + timedelta(days=offset)
            rollup = self.compute_daily(profile_id, day)
            if rollup.count > 0:
                dailies.append(rollup)

        # Compute weekly rollups if requested
        weeklies: list[WeeklyRollup] = []
        if granularity == "weekly":
            week_start = start
            while week_start <= today:
                weekly = self.compute_weekly(profile_id, week_start)
                if weekly.count > 0:
                    weeklies.append(weekly)
                week_start += timedelta(days=7)

        total_count = sum(d.count for d in dailies)
        all_means = [d.mean for d in dailies if d.mean is not None]

        overall_mean = statistics.mean(all_means) if all_means else None
        overall_std = statistics.stdev(all_means) if len(all_means) > 1 else None

        # Linear regression slope on (day_index, daily_mean) pairs
        trend_slope = self._compute_slope(dailies, start)

        return TrendData(
            profile_id=profile_id,
            window_days=window_days,
            granularity=granularity,
            overall_mean=overall_mean,
            overall_std=overall_std,
            trend_slope=trend_slope,
            sample_count=total_count,
            daily_rollups=dailies,
            weekly_rollups=weeklies,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_slope(dailies: list[DailyRollup], start_date: date) -> float | None:
        """Simple linear regression slope on daily means.

        Positive slope = improving, negative = declining.
        Returns None if fewer than 2 data points.
        """
        points: list[tuple[float, float]] = []
        for d in dailies:
            if d.mean is not None:
                x = float((d.date - start_date).days)
                points.append((x, d.mean))

        if len(points) < 2:
            return None

        n = len(points)
        sum_x = sum(p[0] for p in points)
        sum_y = sum(p[1] for p in points)
        sum_xy = sum(p[0] * p[1] for p in points)
        sum_x2 = sum(p[0] ** 2 for p in points)

        denom = n * sum_x2 - sum_x**2
        if denom == 0:
            return 0.0

        slope = (n * sum_xy - sum_x * sum_y) / denom
        return round(slope, 6)
