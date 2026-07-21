"""Tests for Battery Guard SensorHealthMonitor (periodic-sweep model, #56)."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

import pytest

from custom_components.battery_guard.const import (
    CONF_BATTERY_CHARGE_ENTITY,
    CONF_BATTERY_DISCHARGE_ENTITY,
    CONF_BATTERY_OPTIMIZATION,
    CONF_GRID_SENSOR,
    CONF_SOC_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DATA_SENSOR_HEALTH,
    DOMAIN,
    HEALTH_DEBOUNCE_SECONDS,
    HEALTH_STALE_SECONDS,
    HEALTH_STARTUP_GRACE_SECONDS,
    LABEL_TIER1,
)
from tests.conftest import MockEntityEntry, clock, make_state

_PAST_GRACE = HEALTH_STARTUP_GRACE_SECONDS + 1
_PAST_DEBOUNCE = HEALTH_DEBOUNCE_SECONDS + 1


def _make_monitor(mock_hass, data):
    """Create a SensorHealthMonitor with fresh event-helper mocks and a reset clock."""
    import custom_components.battery_guard.sensor_health as sh

    clock.reset()
    sh.async_track_state_change_event = MagicMock(return_value=MagicMock())
    sh.async_track_time_interval = MagicMock(return_value=MagicMock())
    # Default: no tier labels resolve → control-path sweep is a clean no-op. Tests that
    # exercise the control path override these (and reset here keeps ordering robust).
    sh.resolve_label_id = lambda hass, tier: None
    sh.er.async_entries_for_label = MagicMock(return_value=[])

    entry = MagicMock()
    entry.entry_id = "test_entry"
    entry.data = data

    monitor = sh.SensorHealthMonitor(mock_hass, entry)
    # Replace the coroutine-sending notifier with a plain spy.
    monitor._send_notify = MagicMock()
    return monitor


def _states(mapping):
    """side_effect for hass.states.get from {entity_id: MockState|None}."""
    return lambda eid: mapping.get(eid)


def _event(entity_id):
    """A minimal state-change event carrying an entity_id."""
    ev = MagicMock()
    ev.data = {"entity_id": entity_id}
    return ev


def _by_role(sources):
    """Map source role -> entity_ids for assertions."""
    return {s["role"]: s["entity_ids"] for s in sources}


def _titles(spy):
    """Collect the ``title`` kwarg of every _send_notify call."""
    return [c.kwargs.get("title", "") for c in spy.call_args_list]


def _messages(spy):
    """Collect the ``message`` kwarg of every _send_notify call."""
    return [c.kwargs.get("message", "") for c in spy.call_args_list]


# =========================================================================
# _build_sources (unchanged behaviour)
# =========================================================================


class TestBuildSources:
    def test_grid_and_soc(self, mock_hass):
        m = _make_monitor(
            mock_hass,
            {CONF_GRID_SENSOR: "binary_sensor.grid", CONF_SOC_SENSOR: "sensor.soc"},
        )
        assert _by_role(m._build_sources()) == {
            "Grid sensor": ["binary_sensor.grid"],
            "SOC sensor": ["sensor.soc"],
        }

    def test_empty_values_excluded(self, mock_hass):
        m = _make_monitor(mock_hass, {CONF_GRID_SENSOR: "", CONF_SOC_SENSOR: ""})
        assert m._build_sources() == []

    def test_voltage_phases_collapse_to_one_source(self, mock_hass):
        m = _make_monitor(
            mock_hass,
            {
                CONF_USE_VOLTAGE: True,
                CONF_VOLTAGE_PHASE_A: "sensor.va",
                CONF_VOLTAGE_PHASE_B: "sensor.vb",
                CONF_VOLTAGE_PHASE_C: "sensor.vc",
                CONF_SOC_SENSOR: "sensor.soc",
            },
        )
        by_role = _by_role(m._build_sources())
        assert by_role["Grid voltage (3-phase)"] == [
            "sensor.va",
            "sensor.vb",
            "sensor.vc",
        ]
        assert by_role["SOC sensor"] == ["sensor.soc"]

    def test_battery_optimization_only_when_enabled(self, mock_hass):
        base = {CONF_SOC_SENSOR: "sensor.soc"}
        disabled = _make_monitor(
            mock_hass,
            {
                **base,
                CONF_BATTERY_OPTIMIZATION: {
                    "enabled": False,
                    "entities": [{"entity_id": "number.x"}],
                },
            },
        )
        assert not any("number.x" in s["entity_ids"] for s in disabled._build_sources())

        enabled = _make_monitor(
            mock_hass,
            {
                **base,
                CONF_BATTERY_OPTIMIZATION: {
                    "enabled": True,
                    "entities": [{"entity_id": "number.x"}],
                },
            },
        )
        assert any("number.x" in s["entity_ids"] for s in enabled._build_sources())

    def test_charge_discharge_entities_excluded(self, mock_hass):
        m = _make_monitor(
            mock_hass,
            {
                CONF_SOC_SENSOR: "sensor.soc",
                CONF_BATTERY_CHARGE_ENTITY: "number.charge",
                CONF_BATTERY_DISCHARGE_ENTITY: "number.discharge",
            },
        )
        all_eids = [e for s in m._build_sources() for e in s["entity_ids"]]
        assert "number.charge" not in all_eids
        assert "number.discharge" not in all_eids


# =========================================================================
# Dead / stale / recovery (single-entity SOC source)
# =========================================================================


class TestDeadAndStale:
    @pytest.mark.asyncio
    async def test_start_seeds_and_publishes_snapshot(self, mock_hass):
        mock_hass.states.get.side_effect = _states({"sensor.soc": make_state("55")})
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        snap = m.snapshot()
        assert len(snap) == 1
        assert set(snap[0]) == {
            "entity_id",
            "role",
            "available",
            "state",
            "last_available",
            "reason",
        }
        assert snap[0]["entity_id"] == "sensor.soc"
        assert snap[0]["available"] is True
        assert snap[0]["reason"] == "healthy"
        assert mock_hass.data[DOMAIN][DATA_SENSOR_HEALTH] == snap
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_alert_inside_startup_grace(self, mock_hass):
        mock_hass.states.get.side_effect = _states(
            {"sensor.soc": make_state("unavailable")}
        )
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        m._sweep()  # still inside grace → seed only
        assert m._status["sensor.soc"]["available"] is False
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_dead_source_alerts_after_debounce(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        clock.advance(_PAST_GRACE)
        m._sweep()  # first post-grace sweep arms unhealthy_since, no alert yet
        m._send_notify.assert_not_called()
        assert m._status["sensor.soc"]["reason"] == "dead"

        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # sustained past debounce → one alert
        assert m._status["sensor.soc"]["alerted"] is True
        assert m._send_notify.call_count == 1
        assert "unavailable" in _titles(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_dead_alert_not_repeated(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        clock.advance(_PAST_GRACE)
        m._sweep()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # alert
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # still dead — must NOT alert again
        assert m._send_notify.call_count == 1

    @pytest.mark.asyncio
    async def test_recovery_after_alert_notifies(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        clock.advance(_PAST_GRACE)
        m._sweep()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # dead alert
        m._send_notify.reset_mock()

        clock.advance(30)
        mapping["sensor.soc"] = make_state("60")
        m._sweep()  # recovered
        assert m._status["sensor.soc"]["alerted"] is False
        assert m._status["sensor.soc"]["reason"] == "healthy"
        assert m._send_notify.call_count == 1
        assert "available" in _titles(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_frozen_source_alerts_stale(self, mock_hass):
        # Available, but last_reported is far in the past → frozen value.
        old = clock.now - timedelta(seconds=HEALTH_STALE_SECONDS + 120)
        mapping = {"sensor.soc": make_state("55", last_reported=old)}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        clock.advance(_PAST_GRACE)
        m._sweep()  # available but not fresh → reason stale, no alert yet
        assert m._status["sensor.soc"]["available"] is True
        assert m._status["sensor.soc"]["reason"] == "stale"
        m._send_notify.assert_not_called()

        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # sustained stale → alert
        assert m._send_notify.call_count == 1
        assert "stale" in _titles(m._send_notify)[0]
        # Message carries the load-bearing detail (freshness window + role).
        assert "15 min" in _messages(m._send_notify)[0]
        assert "SOC sensor" in _messages(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_static_but_polled_sensor_is_not_stale(self, mock_hass):
        # A grid enum that reads the same for a long time but IS polled: last_reported
        # keeps advancing. Must never be flagged stale (concept-review Blocker 1).
        mapping = {"sensor.grid": make_state("On-grid")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_GRID_SENSOR: "sensor.grid"})
        await m.async_start()

        clock.advance(_PAST_GRACE)
        # Re-poll: value unchanged, but last_reported bumped to "now".
        mapping["sensor.grid"] = make_state("On-grid", last_reported=clock.now)
        m._sweep()
        assert m._status["sensor.grid"]["reason"] == "healthy"
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_last_reported_is_fresh(self, mock_hass):
        # Fail-open: no last_reported at all → treated as fresh, never a false stale.
        state = make_state("55")
        state.last_reported = None
        mapping = {"sensor.soc": state}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        clock.advance(_PAST_GRACE + _PAST_DEBOUNCE)
        m._sweep()
        assert m._status["sensor.soc"]["reason"] == "healthy"
        m._send_notify.assert_not_called()


# =========================================================================
# Flapping (unstable)
# =========================================================================


class TestFlapping:
    def _drop_recover(self, m, mapping, eid):
        mapping[eid] = make_state("unavailable")
        m._handle_change(_event(eid))
        mapping[eid] = make_state("55")
        m._handle_change(_event(eid))

    @pytest.mark.asyncio
    async def test_three_short_dropouts_alert_unstable(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        for _ in range(3):
            self._drop_recover(m, mapping, "sensor.soc")
        assert len(m._status["sensor.soc"]["flap_edges"]) == 3

        clock.advance(_PAST_GRACE)
        m._sweep()  # currently available, but 3 edges in window → unstable
        assert m._status["sensor.soc"]["reason"] == "unstable"
        assert m._send_notify.call_count == 1
        assert "unstable" in _titles(m._send_notify)[0]
        # Message reports the actual drop count and window.
        assert "3 times" in _messages(m._send_notify)[0]
        assert "10 min" in _messages(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_unstable_recovers_after_window_clears(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        for _ in range(3):
            self._drop_recover(m, mapping, "sensor.soc")
        clock.advance(_PAST_GRACE)
        m._sweep()  # unstable alert
        assert m._status["sensor.soc"]["alert_reason"] == "unstable"
        m._send_notify.reset_mock()

        # No new dropouts for the whole flap window → edges age out, source healthy.
        clock.advance(601)
        m._sweep()
        assert m._status["sensor.soc"]["alerted"] is False
        assert m._status["sensor.soc"]["alert_reason"] is None
        assert len(m._status["sensor.soc"]["flap_edges"]) == 0
        assert m._send_notify.call_count == 1  # single recovery notice
        assert "available" in _titles(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_two_dropouts_do_not_alert(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        for _ in range(2):
            self._drop_recover(m, mapping, "sensor.soc")
        clock.advance(_PAST_GRACE)
        m._sweep()
        assert m._status["sensor.soc"]["reason"] == "healthy"
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_old_edges_prune_out_of_window(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        for _ in range(3):
            self._drop_recover(m, mapping, "sensor.soc")
        # Age the edges past the flap window before the first post-grace sweep.
        clock.advance(_PAST_GRACE + 601)
        m._sweep()
        assert len(m._status["sensor.soc"]["flap_edges"]) == 0
        assert m._status["sensor.soc"]["reason"] == "healthy"
        m._send_notify.assert_not_called()


# =========================================================================
# Voltage 3-phase source — one flap edge, one alert (BLOCKER-2 regression)
# =========================================================================


class TestVoltageSource:
    def _voltage_monitor(self, mock_hass, mapping):
        mock_hass.states.get.side_effect = _states(mapping)
        return _make_monitor(
            mock_hass,
            {
                CONF_USE_VOLTAGE: True,
                CONF_VOLTAGE_PHASE_A: "sensor.va",
                CONF_VOLTAGE_PHASE_B: "sensor.vb",
                CONF_VOLTAGE_PHASE_C: "sensor.vc",
            },
        )

    @pytest.mark.asyncio
    async def test_simultaneous_three_phase_drop_records_one_edge(self, mock_hass):
        mapping = {
            "sensor.va": make_state("230"),
            "sensor.vb": make_state("231"),
            "sensor.vc": make_state("229"),
        }
        m = self._voltage_monitor(mock_hass, mapping)
        await m.async_start()
        assert set(m._status) == {"voltage"}
        assert m._status["voltage"]["available"] is True

        # All three phases drop together → three per-entity events, ONE source edge.
        for eid in ("sensor.va", "sensor.vb", "sensor.vc"):
            mapping[eid] = make_state("unavailable")
        m._handle_change(_event("sensor.va"))
        m._handle_change(_event("sensor.vb"))
        m._handle_change(_event("sensor.vc"))

        assert len(m._status["voltage"]["flap_edges"]) == 1  # not three

        clock.advance(_PAST_GRACE)
        m._sweep()  # dead (all down), first post-grace sweep → no alert yet
        m._send_notify.assert_not_called()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # one alert for the 3-phase source
        assert m._send_notify.call_count == 1

    @pytest.mark.asyncio
    async def test_one_phase_down_marks_source_unavailable(self, mock_hass):
        mapping = {
            "sensor.va": make_state("230"),
            "sensor.vb": make_state("unavailable"),
            "sensor.vc": make_state("229"),
        }
        m = self._voltage_monitor(mock_hass, mapping)
        await m.async_start()
        assert m._status["voltage"]["available"] is False

    @pytest.mark.asyncio
    async def test_snapshot_summarizes_multi_entity_source(self, mock_hass):
        mapping = {
            "sensor.va": make_state("230"),
            "sensor.vb": make_state("unavailable"),
            "sensor.vc": make_state("229"),
        }
        m = self._voltage_monitor(mock_hass, mapping)
        await m.async_start()
        snap = m.snapshot()
        assert len(snap) == 1
        item = snap[0]
        assert item["entity_id"] == "sensor.va, sensor.vb, sensor.vc"
        assert item["state"] == "2/3 available"
        assert item["available"] is False


# =========================================================================
# Empty config + notify isolation
# =========================================================================


class TestEmptyAndIsolation:
    @pytest.mark.asyncio
    async def test_no_required_no_alerts(self, mock_hass):
        m = _make_monitor(mock_hass, {CONF_GRID_SENSOR: "", CONF_SOC_SENSOR: ""})
        await m.async_start()
        assert m.snapshot() == []
        clock.advance(_PAST_GRACE + _PAST_DEBOUNCE)
        m._sweep()
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_entity_alerts_dead(self, mock_hass):
        mock_hass.states.get.side_effect = _states({})  # entity not present
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()
        assert m._status["sensor.soc"]["available"] is False
        clock.advance(_PAST_GRACE)
        m._sweep()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()
        assert m._send_notify.call_count == 1

    @pytest.mark.asyncio
    async def test_sweep_never_raises(self, mock_hass):
        # A states.get that raises must not propagate out of the sweep.
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()
        mock_hass.states.get = MagicMock(side_effect=RuntimeError("boom"))
        clock.advance(_PAST_GRACE)
        m._sweep()  # must swallow

    @pytest.mark.asyncio
    async def test_send_notify_swallows_errors(self, mock_hass):
        from unittest.mock import AsyncMock

        mock_hass.services.async_call = AsyncMock(side_effect=RuntimeError("boom"))
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await type(m)._send_notify(m, title="t", message="msg")
        mock_hass.services.async_call.assert_awaited_once()


# =========================================================================
# AC4 — no false alarm across a real Modbus reconnect-and-recover cycle
# =========================================================================


class TestStartupReconnect:
    @pytest.mark.asyncio
    async def test_no_alarm_when_source_reconnects_within_grace(self, mock_hass):
        # Boot unavailable (Huawei/Modbus still connecting), reconnects ~150 s later,
        # then stays healthy. Sweeps run every 30 s. NO alert may ever fire.
        mapping = {"sensor.grid": make_state("unavailable")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_GRID_SENSOR: "sensor.grid"})
        await m.async_start()

        for step in range(1, 12):  # 30 s .. 330 s, across the 180 s grace boundary
            clock.advance(30)
            if step * 30 >= 150:  # Modbus reconnects at ~150 s
                mapping["sensor.grid"] = make_state("On-grid", last_reported=clock.now)
            m._sweep()

        m._send_notify.assert_not_called()
        assert m._status["sensor.grid"]["reason"] == "healthy"


# =========================================================================
# AC5 — control path (tier device unavailable → cannot be shed)
# =========================================================================


class TestControlPath:
    def _cp_monitor(self, mock_hass, members, states, disabled=(), resolve=True):
        """A monitor with no sensor sources; tier labels resolve to ``members``."""
        import custom_components.battery_guard.sensor_health as sh

        m = _make_monitor(mock_hass, {})  # no sensor sources → only control path runs
        sh.resolve_label_id = (
            (lambda hass, tier: f"lbl_{tier}") if resolve else (lambda hass, tier: None)
        )
        sh.er.async_get = MagicMock(return_value=MagicMock())

        entries = [
            MockEntityEntry(eid, disabled_by=("user" if eid in disabled else None))
            for eid in members
        ]
        # Members belong to TIER1; TIER2 resolves to an empty set.
        sh.er.async_entries_for_label = MagicMock(
            side_effect=lambda reg, label_id: (
                entries if label_id.endswith(LABEL_TIER1) else []
            )
        )
        mock_hass.states.get.side_effect = lambda eid: states.get(eid)
        return m, sh

    @pytest.mark.asyncio
    async def test_unavailable_tier_device_alerts_cannot_be_shed(self, mock_hass):
        states = {"switch.klima": make_state("unavailable")}
        m, _ = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()

        clock.advance(_PAST_GRACE)
        m._sweep()  # arms unhealthy_since, no alert yet
        m._send_notify.assert_not_called()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # sustained → alert
        assert m._send_notify.call_count == 1
        assert "unreachable" in _titles(m._send_notify)[0]
        assert "cannot be shed" in _messages(m._send_notify)[0]

    @pytest.mark.asyncio
    async def test_available_tier_device_no_alert(self, mock_hass):
        states = {"switch.klima": make_state("on")}
        m, _ = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()
        clock.advance(_PAST_GRACE + _PAST_DEBOUNCE)
        m._sweep()
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_off_tier_device_is_not_a_fault(self, mock_hass):
        # A tier device that is legitimately OFF must not be flagged (off != unavailable).
        states = {"switch.klima": make_state("off")}
        m, _ = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()
        clock.advance(_PAST_GRACE + _PAST_DEBOUNCE)
        m._sweep()
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_disabled_tier_device_not_alerted(self, mock_hass):
        states = {"switch.dis": make_state("unavailable")}
        m, _ = self._cp_monitor(
            mock_hass, ["switch.dis"], states, disabled={"switch.dis"}
        )
        await m.async_start()
        clock.advance(_PAST_GRACE + _PAST_DEBOUNCE)
        m._sweep()
        m._send_notify.assert_not_called()
        assert "switch.dis" not in m._control

    @pytest.mark.asyncio
    async def test_unresolved_labels_no_alert_no_state_wipe(self, mock_hass):
        states = {"switch.klima": make_state("unavailable")}
        m, sh = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()
        # First alert with labels resolving.
        clock.advance(_PAST_GRACE)
        m._sweep()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()
        assert m._send_notify.call_count == 1
        m._send_notify.reset_mock()

        # Labels transiently stop resolving → must short-circuit, NOT wipe state.
        sh.resolve_label_id = lambda hass, tier: None
        clock.advance(30)
        m._sweep()
        m._send_notify.assert_not_called()
        assert "switch.klima" in m._control  # state preserved (no duplicate re-alert)

    @pytest.mark.asyncio
    async def test_recovery_fires_reachable(self, mock_hass):
        states = {"switch.klima": make_state("unavailable")}
        m, _ = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()
        clock.advance(_PAST_GRACE)
        m._sweep()
        clock.advance(_PAST_DEBOUNCE)
        m._sweep()  # alert
        m._send_notify.reset_mock()

        states["switch.klima"] = make_state("on")
        clock.advance(30)
        m._sweep()  # recovered
        assert m._send_notify.call_count == 1
        title = _titles(m._send_notify)[0]
        assert "✅" in title and "reachable" in title

    @pytest.mark.asyncio
    async def test_member_leaving_label_is_dropped(self, mock_hass):
        states = {"switch.klima": make_state("on")}
        m, sh = self._cp_monitor(mock_hass, ["switch.klima"], states)
        await m.async_start()
        clock.advance(_PAST_GRACE)
        m._sweep()
        assert "switch.klima" in m._control

        # Device leaves the tier label entirely.
        sh.er.async_entries_for_label = MagicMock(return_value=[])
        clock.advance(30)
        m._sweep()
        assert "switch.klima" not in m._control
