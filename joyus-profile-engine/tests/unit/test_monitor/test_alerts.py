"""Tests for AlertGenerator: generation, severity, acknowledge."""

from __future__ import annotations

from joyus_profile.monitor.alerts import AlertGenerator

from .conftest import PROFILE_ID, make_signal


class TestGenerateAlerts:
    def test_no_signals_no_alerts(self, alert_generator: AlertGenerator):
        alerts = alert_generator.generate_alerts(PROFILE_ID, [])
        assert alerts == []

    def test_single_signal_produces_alert(self, alert_generator: AlertGenerator):
        signal = make_signal(severity="low")
        alerts = alert_generator.generate_alerts(PROFILE_ID, [signal])

        assert len(alerts) == 1
        alert = alerts[0]
        assert alert.profile_id == PROFILE_ID
        assert alert.severity == "low"
        assert len(alert.signals) == 1
        assert alert.acknowledged is False

    def test_alert_has_summary(self, alert_generator: AlertGenerator):
        signal = make_signal()
        alerts = alert_generator.generate_alerts(PROFILE_ID, [signal])
        assert alerts[0].summary
        assert "drift signal" in alerts[0].summary.lower()

    def test_alert_id_is_unique(self, alert_generator: AlertGenerator):
        s1 = make_signal()
        s2 = make_signal(signal_type="marker_shift")
        a1 = alert_generator.generate_alerts(PROFILE_ID, [s1])
        a2 = alert_generator.generate_alerts(PROFILE_ID, [s2])
        assert a1[0].alert_id != a2[0].alert_id


class TestSeverityEscalation:
    def test_max_severity_from_signals(self, alert_generator: AlertGenerator):
        signals = [
            make_signal(severity="low"),
            make_signal(severity="high", signal_type="marker_shift"),
        ]
        alerts = alert_generator.generate_alerts(PROFILE_ID, signals)
        assert alerts[0].severity == "high"

    def test_three_signals_escalate_to_high(self, alert_generator: AlertGenerator):
        signals = [
            make_signal(severity="low", signal_type="fidelity_decline"),
            make_signal(severity="low", signal_type="marker_shift"),
            make_signal(severity="low", signal_type="inconsistency"),
        ]
        alerts = alert_generator.generate_alerts(PROFILE_ID, signals)
        assert alerts[0].severity == "high"  # Escalated from low

    def test_critical_signal_stays_critical(self, alert_generator: AlertGenerator):
        signal = make_signal(severity="critical", signal_type="negative_increase")
        alerts = alert_generator.generate_alerts(PROFILE_ID, [signal])
        assert alerts[0].severity == "critical"
        assert alerts[0].requires_immediate is True


class TestGetAlerts:
    def test_query_by_profile(self, alert_generator: AlertGenerator):
        alert_generator.generate_alerts("prof_a", [make_signal(profile_id="prof_a")])
        alert_generator.generate_alerts("prof_b", [make_signal(profile_id="prof_b")])

        a_alerts = alert_generator.get_alerts(profile_id="prof_a")
        assert len(a_alerts) == 1
        assert a_alerts[0].profile_id == "prof_a"

    def test_query_unacknowledged(self, alert_generator: AlertGenerator):
        alert_generator.generate_alerts(PROFILE_ID, [make_signal()])
        alert_generator.generate_alerts(PROFILE_ID, [make_signal(signal_type="marker_shift")])

        unacked = alert_generator.get_alerts(acknowledged=False)
        assert len(unacked) == 2

    def test_query_all(self, alert_generator: AlertGenerator):
        alert_generator.generate_alerts(PROFILE_ID, [make_signal()])
        all_alerts = alert_generator.get_alerts()
        assert len(all_alerts) == 1


class TestAcknowledge:
    def test_acknowledge_marks_read(self, alert_generator: AlertGenerator):
        alert_generator.generate_alerts(PROFILE_ID, [make_signal()])
        alerts = alert_generator.get_alerts()
        assert len(alerts) == 1
        assert alerts[0].acknowledged is False

        alert_generator.acknowledge(alerts[0].alert_id)

        updated = alert_generator.get_alerts()
        assert updated[0].acknowledged is True

    def test_acknowledge_nonexistent_noop(self, alert_generator: AlertGenerator):
        # Should not raise
        alert_generator.acknowledge("nonexistent_id")

    def test_acknowledge_only_target(self, alert_generator: AlertGenerator):
        alert_generator.generate_alerts(PROFILE_ID, [make_signal()])
        alert_generator.generate_alerts(
            PROFILE_ID, [make_signal(signal_type="marker_shift")]
        )

        alerts = alert_generator.get_alerts()
        alert_generator.acknowledge(alerts[0].alert_id)

        updated = alert_generator.get_alerts()
        acked = [a for a in updated if a.acknowledged]
        unacked = [a for a in updated if not a.acknowledged]
        assert len(acked) == 1
        assert len(unacked) == 1
