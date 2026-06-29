"""Tests for Battery Guard SensorHealthMonitor."""

from __future__ import annotations

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
)
from tests.conftest import make_state


def _make_monitor(mock_hass, data):
    """Create a SensorHealthMonitor with fresh event-helper mocks."""
    import custom_components.battery_guard.sensor_health as sh

    # Fresh per-call mocks so debounce/listener assertions are reliable.
    sh.async_call_later = MagicMock(side_effect=lambda *a, **k: MagicMock())
    sh.async_track_state_change_event = MagicMock(return_value=MagicMock())

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


def _by_role(sources):
    """Map source role -> entity_ids for assertions."""
    return {s["role"]: s["entity_ids"] for s in sources}


# =========================================================================
# _build_sources
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
        assert not any(
            "number.x" in s["entity_ids"] for s in disabled._build_sources()
        )

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
# Lifecycle / transitions (single-entity SOC source)
# =========================================================================


class TestTransitions:
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
        }
        assert snap[0]["entity_id"] == "sensor.soc"
        assert snap[0]["available"] is True
        assert mock_hass.data[DOMAIN][DATA_SENSOR_HEALTH] == snap
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_unavailable_is_debounced_then_notifies(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        m._reevaluate("sensor.soc")
        assert m._status["sensor.soc"]["available"] is False
        assert "sensor.soc" in m._debounce
        m._send_notify.assert_not_called()  # debounced — no immediate alert

        m._debounce_fired("sensor.soc")  # still unavailable -> alert once
        assert m._status["sensor.soc"]["alerted"] is True
        assert m._send_notify.call_count == 1

    @pytest.mark.asyncio
    async def test_recovery_after_alert_notifies(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        m._reevaluate("sensor.soc")
        m._debounce_fired("sensor.soc")
        m._send_notify.reset_mock()

        mapping["sensor.soc"] = make_state("60")
        m._reevaluate("sensor.soc")
        assert m._status["sensor.soc"]["available"] is True
        assert m._status["sensor.soc"]["alerted"] is False
        assert m._send_notify.call_count == 1  # recovery notice

    @pytest.mark.asyncio
    async def test_flapping_before_debounce_no_alert(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        m._reevaluate("sensor.soc")
        cancel = m._debounce["sensor.soc"]

        mapping["sensor.soc"] = make_state("56")  # recovers before debounce
        m._reevaluate("sensor.soc")
        cancel.assert_called_once()  # pending timer cancelled
        assert "sensor.soc" not in m._debounce
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_debounce_fired_but_recovered_no_alert(self, mock_hass):
        mapping = {"sensor.soc": make_state("55")}
        mock_hass.states.get.side_effect = _states(mapping)
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()

        mapping["sensor.soc"] = make_state("unavailable")
        m._reevaluate("sensor.soc")
        mapping["sensor.soc"] = make_state("57")  # back before debounce fires
        m._debounce_fired("sensor.soc")
        assert m._status["sensor.soc"]["available"] is True
        assert m._status["sensor.soc"]["alerted"] is False
        m._send_notify.assert_not_called()


# =========================================================================
# Voltage 3-phase source — one alert, not three (BLOCKER regression test)
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
    async def test_simultaneous_drop_emits_single_alert(self, mock_hass):
        mapping = {
            "sensor.va": make_state("230"),
            "sensor.vb": make_state("231"),
            "sensor.vc": make_state("229"),
        }
        m = self._voltage_monitor(mock_hass, mapping)
        await m.async_start()
        assert set(m._status) == {"voltage"}
        assert m._status["voltage"]["available"] is True

        # All three phases drop together → one event per phase, but one source.
        for eid in ("sensor.va", "sensor.vb", "sensor.vc"):
            mapping[eid] = make_state("unavailable")
        m._reevaluate("voltage")
        m._reevaluate("voltage")
        m._reevaluate("voltage")
        assert list(m._debounce) == ["voltage"]  # only one timer armed
        m._send_notify.assert_not_called()

        m._debounce_fired("voltage")
        assert m._send_notify.call_count == 1  # single alert for the 3-phase source

    @pytest.mark.asyncio
    async def test_one_phase_down_marks_source_unavailable(self, mock_hass):
        mapping = {
            "sensor.va": make_state("230"),
            "sensor.vb": make_state("unavailable"),
            "sensor.vc": make_state("229"),
        }
        m = self._voltage_monitor(mock_hass, mapping)
        await m.async_start()
        # all() semantics: any phase down => source unavailable
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
# Startup check + empty config
# =========================================================================


class TestStartupAndEmpty:
    @pytest.mark.asyncio
    async def test_no_required_no_alerts(self, mock_hass):
        m = _make_monitor(mock_hass, {CONF_GRID_SENSOR: "", CONF_SOC_SENSOR: ""})
        await m.async_start()
        assert m.snapshot() == []
        m._startup_check(None)
        m._send_notify.assert_not_called()

    @pytest.mark.asyncio
    async def test_startup_check_reports_static_unavailable(self, mock_hass):
        mock_hass.states.get.side_effect = _states(
            {"sensor.soc": make_state("unavailable")}
        )
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()
        assert m._status["sensor.soc"]["available"] is False
        m._send_notify.assert_not_called()  # not yet — grace period

        m._startup_check(None)
        assert m._status["sensor.soc"]["alerted"] is True
        assert m._send_notify.call_count == 1

    @pytest.mark.asyncio
    async def test_missing_entity_treated_as_unavailable(self, mock_hass):
        mock_hass.states.get.side_effect = _states({})  # entity not present
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        await m.async_start()
        assert m._status["sensor.soc"]["available"] is False
        m._startup_check(None)
        assert m._send_notify.call_count == 1


class TestNotifyIsolation:
    @pytest.mark.asyncio
    async def test_send_notify_swallows_errors(self, mock_hass):
        """The watchdog must never raise into HA, even if notify fails."""
        from unittest.mock import AsyncMock

        mock_hass.services.async_call = AsyncMock(side_effect=RuntimeError("boom"))
        m = _make_monitor(mock_hass, {CONF_SOC_SENSOR: "sensor.soc"})
        # Invoke the REAL _send_notify (not the test spy) — must not raise.
        await type(m)._send_notify(m, title="t", message="msg")
        mock_hass.services.async_call.assert_awaited_once()
