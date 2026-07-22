"""Tests for #70 — a restore requires a POSITIVELY confirmed on-grid reading.

The bug this guards against: the power-outage binary sensor collapses a dead or
unrecognised grid source to "no outage". That is correct for DETECTION (a comms
loss must never shed load), but as a restore trigger it means "switch every shed
device back on" while the outage is still running.

These tests therefore assert the asymmetry: detection may infer an outage from a
positive off-grid value, while restoring may only ever act on a positive on-grid
value. Anything in between is UNKNOWN — shed devices stay off and the operator is
told why.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.battery_guard.const import (
    CONF_GRID_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DOMAIN,
    RESTORE_STARTUP_GRACE_SECONDS,
    RESTORE_SUSPENDED_RENOTIFY_SECONDS,
    VOLTAGE_OUTAGE_THRESHOLD,
)
from custom_components.battery_guard.grid_status import (
    GRID_OFF,
    GRID_ON,
    GRID_UNKNOWN,
    classify_grid_status,
    classify_grid_voltage,
)
from tests.conftest import GRID_SENSOR_ENTITY, make_state


def _make_engine(mock_hass, mock_entry):
    with patch(
        "custom_components.battery_guard.automation_engine.async_track_state_change_event"
    ):
        from custom_components.battery_guard.automation_engine import (
            BatteryGuardAutomationEngine,
        )

        return BatteryGuardAutomationEngine(mock_hass, mock_entry)


def _grid(mock_hass, value):
    """Point the raw grid source at `value` (None = entity missing entirely)."""
    mock_hass.states.get = MagicMock(
        side_effect=lambda eid: (
            make_state(value)
            if eid == GRID_SENSOR_ENTITY and value is not None
            else None
        )
    )


def _notify_calls(mock_hass):
    return [
        c
        for c in mock_hass.services.async_call.call_args_list
        if c.args[0] == DOMAIN and c.args[1] == "notify"
    ]


def _restore_calls(mock_hass):
    return [
        c
        for c in mock_hass.services.async_call.call_args_list
        if c.args[0] == DOMAIN and c.args[1] == "restore_all"
    ]


@pytest.fixture(autouse=True)
def _no_dangling_coroutines(mock_hass):
    """The suspension notice is fired from a @callback via async_create_task."""
    mock_hass.async_create_task = MagicMock(side_effect=lambda coro: coro.close())


# =========================================================================
# Pure classification
# =========================================================================


class TestClassifyGridStatus:
    @pytest.mark.parametrize(
        "raw",
        ["on-grid", "On-Grid", " ongrid ", "on_grid", "on grid", "Grid connected"],
    )
    def test_recognised_on_grid_values(self, raw):
        assert classify_grid_status(raw) == GRID_ON

    @pytest.mark.parametrize(
        "raw", ["off-grid", "OFF_GRID", "offgrid", "Off-grid mode: Running"]
    )
    def test_recognised_off_grid_values(self, raw):
        assert classify_grid_status(raw) == GRID_OFF

    @pytest.mark.parametrize("raw", [None, "", "   ", "unavailable", "unknown"])
    def test_missing_source_is_unknown(self, raw):
        assert classify_grid_status(raw) == GRID_UNKNOWN

    def test_comms_fault_is_unknown_not_on(self):
        """The exact value that made the outage sensor read 'no outage'."""
        assert (
            classify_grid_status("Shutdown: communication disconnected") == GRID_UNKNOWN
        )

    def test_unrecognised_value_never_authorises_restore(self):
        assert classify_grid_status("Standby: no irradiation") == GRID_UNKNOWN

    def test_bare_on_is_not_accepted(self):
        """A binary source's 'on' is as likely to mean 'outage' as 'grid present'."""
        assert classify_grid_status("on") == GRID_UNKNOWN


class TestClassifyGridVoltage:
    def test_all_phases_above_threshold_is_on(self):
        assert classify_grid_voltage(["230.1", "229.8", "231.0"], 50.0) == GRID_ON

    def test_all_phases_below_threshold_is_off(self):
        assert classify_grid_voltage(["0", "0.4", "1.2"], 50.0) == GRID_OFF

    def test_mixed_phases_are_unknown(self):
        """A single-phase outage must never authorise a full restore."""
        assert classify_grid_voltage(["230", "0", "229"], 50.0) == GRID_UNKNOWN

    def test_one_unreadable_phase_is_unknown(self):
        assert (
            classify_grid_voltage(["230", "unavailable", "229"], 50.0) == GRID_UNKNOWN
        )

    def test_missing_phase_is_unknown(self):
        assert classify_grid_voltage(["230", None, "229"], 50.0) == GRID_UNKNOWN

    def test_non_numeric_is_unknown(self):
        assert classify_grid_voltage(["230", "n/a", "229"], 50.0) == GRID_UNKNOWN

    def test_empty_input_is_unknown_not_off(self):
        """all([]) is True — without the guard this would read as a power outage."""
        assert classify_grid_voltage([], 50.0) == GRID_UNKNOWN


# =========================================================================
# Engine: source resolution
# =========================================================================


class TestRawGridSources:
    def test_grid_sensor_mode(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._raw_grid_sources() == [GRID_SENSOR_ENTITY]

    def test_voltage_mode_returns_all_three_phases(self, mock_hass, mock_entry):
        mock_entry.data = {
            **mock_entry.data,
            CONF_USE_VOLTAGE: True,
            CONF_VOLTAGE_PHASE_A: "sensor.a",
            CONF_VOLTAGE_PHASE_B: "sensor.b",
            CONF_VOLTAGE_PHASE_C: "sensor.c",
        }
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._raw_grid_sources() == ["sensor.a", "sensor.b", "sensor.c"]

    def test_unconfigured_source_yields_unknown(self, mock_hass, mock_entry):
        mock_entry.data = {**mock_entry.data, CONF_GRID_SENSOR: ""}
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._raw_grid_sources() == []
        assert engine._grid_state() == GRID_UNKNOWN


# =========================================================================
# Engine: the restore gate itself
# =========================================================================


class TestRestoreGate:
    def _armed(self, mock_hass, mock_entry, grid_value):
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)
        _grid(mock_hass, grid_value)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 3, "failed": []}}
        return engine

    @pytest.mark.asyncio
    async def test_confirmed_on_grid_restores(self, mock_hass, mock_entry):
        engine = self._armed(mock_hass, mock_entry, "on-grid")
        await engine._on_grid_restored()
        assert len(_restore_calls(mock_hass)) == 1

    @pytest.mark.asyncio
    async def test_dead_source_does_not_restore(self, mock_hass, mock_entry):
        """The #70 core: 'unavailable' must not be read as 'grid is back'."""
        engine = self._armed(mock_hass, mock_entry, "unavailable")
        await engine._on_grid_restored()
        assert _restore_calls(mock_hass) == []

    @pytest.mark.asyncio
    async def test_missing_entity_does_not_restore(self, mock_hass, mock_entry):
        engine = self._armed(mock_hass, mock_entry, None)
        await engine._on_grid_restored()
        assert _restore_calls(mock_hass) == []

    @pytest.mark.asyncio
    async def test_unknown_source_reports_the_blocking_value(
        self, mock_hass, mock_entry
    ):
        engine = self._armed(mock_hass, mock_entry, "unavailable")
        await engine._on_grid_restored()

        notifications = _notify_calls(mock_hass)
        assert len(notifications) == 1
        payload = notifications[0].args[2]
        assert "suspend" in payload["title"].lower()
        assert "unavailable" in payload["message"]

    @pytest.mark.asyncio
    async def test_still_off_grid_does_not_restore_and_stays_quiet(
        self, mock_hass, mock_entry
    ):
        """An ongoing outage is not news — no notification, no restore."""
        engine = self._armed(mock_hass, mock_entry, "off-grid")
        await engine._on_grid_restored()
        assert _restore_calls(mock_hass) == []
        assert _notify_calls(mock_hass) == []

    @pytest.mark.asyncio
    async def test_gate_runs_after_the_active_check(self, mock_hass, mock_entry):
        """Not in emergency mode → nothing at all, not even a suspension notice."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=False)
        _grid(mock_hass, "unavailable")

        await engine._on_grid_restored()

        mock_hass.services.async_call.assert_not_called()


class TestSuspensionNotice:
    @pytest.mark.asyncio
    async def test_same_blocking_value_is_reported_only_once(
        self, mock_hass, mock_entry
    ):
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)
        _grid(mock_hass, "unavailable")

        await engine._on_grid_restored()
        await engine._on_grid_restored()

        assert len(_notify_calls(mock_hass)) == 1

    @pytest.mark.asyncio
    async def test_changed_cause_is_reported_again_after_the_rate_limit(
        self, mock_hass, mock_entry
    ):
        """The operator must learn WHICH value blocks them — a changed cause is news."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)

        with patch(
            "custom_components.battery_guard.automation_engine.time"
        ) as mock_time:
            mock_time.monotonic.return_value = 0.0
            _grid(mock_hass, "unavailable")
            await engine._on_grid_restored()

            mock_time.monotonic.return_value = RESTORE_SUSPENDED_RENOTIFY_SECONDS + 1
            _grid(mock_hass, "Shutdown: communication disconnected")
            await engine._on_grid_restored()

        notifications = _notify_calls(mock_hass)
        assert len(notifications) == 2
        assert "communication disconnected" in notifications[1].args[2]["message"]

    @pytest.mark.asyncio
    async def test_changed_cause_is_rate_limited_but_not_lost(
        self, mock_hass, mock_entry
    ):
        """Suppressed inside the window, then delivered — never silently dropped."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)

        with patch(
            "custom_components.battery_guard.automation_engine.time"
        ) as mock_time:
            mock_time.monotonic.return_value = 0.0
            _grid(mock_hass, "unavailable")
            await engine._on_grid_restored()

            # New cause, still inside the window → suppressed
            mock_time.monotonic.return_value = 60.0
            _grid(mock_hass, "Standby: no irradiation")
            await engine._on_grid_restored()
            assert len(_notify_calls(mock_hass)) == 1

            # Same cause, window now open → delivered
            mock_time.monotonic.return_value = RESTORE_SUSPENDED_RENOTIFY_SECONDS + 1
            await engine._on_grid_restored()

        notifications = _notify_calls(mock_hass)
        assert len(notifications) == 2
        assert "Standby: no irradiation" in notifications[1].args[2]["message"]

    def test_voltage_readings_do_not_count_as_a_changed_cause(
        self, mock_hass, mock_entry
    ):
        """Regression: the dedupe key must not contain live measurements.

        Keyed on the displayed reading, a Shelly 3EM polling ~1/s produced one
        push per poll for the whole outage — burying the critical-SOC alarm.

        The clock is advanced past the rate-limit window on every poll ON PURPOSE:
        otherwise the rate limiter alone would keep this green and the test would
        pass even with the broken key. Only the cause signature may suppress here.
        """
        mock_entry.data = {
            **mock_entry.data,
            CONF_USE_VOLTAGE: True,
            CONF_VOLTAGE_PHASE_A: "sensor.a",
            CONF_VOLTAGE_PHASE_B: "sensor.b",
            CONF_VOLTAGE_PHASE_C: "sensor.c",
        }
        engine = _make_engine(mock_hass, mock_entry)
        engine._emergency_active = MagicMock(return_value=True)

        with patch(
            "custom_components.battery_guard.automation_engine.time"
        ) as mock_time:
            for poll in range(10):
                mock_time.monotonic.return_value = poll * (
                    RESTORE_SUSPENDED_RENOTIFY_SECONDS + 1
                )
                # Phase B dead, A and C jittering — the #70 degradation regime.
                readings = {
                    "sensor.a": f"230.{poll}",
                    "sensor.b": "unavailable",
                    "sensor.c": f"229.{poll}",
                }
                mock_hass.states.get = MagicMock(
                    side_effect=lambda eid: (
                        make_state(readings[eid]) if eid in readings else None
                    )
                )
                engine._evaluate_grid_source()

        assert len(_notify_calls(mock_hass)) == 1

    def test_end_of_emergency_rearms_the_notice(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._restore_suspended_cause = ("sensor.grid_status=unavailable",)
        engine._restore_suspended_notified_at = 123.0

        event = MagicMock()
        event.data = {"new_state": make_state("off")}
        engine._handle_active_change(event)

        assert engine._restore_suspended_cause is None
        assert engine._restore_suspended_notified_at is None

    def test_transient_unavailable_of_the_switch_does_not_rearm(
        self, mock_hass, mock_entry
    ):
        engine = _make_engine(mock_hass, mock_entry)
        cause = ("sensor.grid_status=unavailable",)
        engine._restore_suspended_cause = cause

        event = MagicMock()
        event.data = {"new_state": make_state("unavailable")}
        engine._handle_active_change(event)

        assert engine._restore_suspended_cause == cause


class TestReEntryGuardAfterManualRestore:
    """A suspended restore makes `restore_all` the documented escape hatch.

    That path resets the `active` switch but used to leave `_outage_start_time`
    set — and `_on_power_outage` skips re-entry while it is set. The NEXT real
    outage would then be silently ignored: no shed, no notification, no log above
    DEBUG, battery draining at full house load.
    """

    def test_active_off_clears_the_outage_start_time(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._outage_start_time = 1000.0

        event = MagicMock()
        event.data = {"new_state": make_state("off")}
        engine._handle_active_change(event)

        assert engine._outage_start_time is None

    def test_transient_unavailable_keeps_the_outage_start_time(
        self, mock_hass, mock_entry
    ):
        """Mid-emergency the guard must survive a flickering switch entity."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._outage_start_time = 1000.0

        event = MagicMock()
        event.data = {"new_state": make_state("unavailable")}
        engine._handle_active_change(event)

        assert engine._outage_start_time == 1000.0

    @pytest.mark.asyncio
    async def test_restore_still_reports_the_outage_duration(
        self, mock_hass, mock_entry
    ):
        """restore_all clears the flag mid-await — the duration must survive."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)
        _grid(mock_hass, "on-grid")
        engine._outage_start_time = 1000.0
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}

        async def _clear_flag_like_restore_all(*args, **kwargs):
            engine._outage_start_time = None

        mock_hass.services.async_call = AsyncMock(
            side_effect=_clear_flag_like_restore_all
        )

        with patch(
            "custom_components.battery_guard.automation_engine.time"
        ) as mock_time:
            mock_time.monotonic.return_value = 4600.0
            await engine._on_grid_restored()

        notifications = _notify_calls(mock_hass)
        assert len(notifications) == 1
        assert "duration" in notifications[0].args[2]["message"].lower()


class TestEmergencyEntityResolution:
    def test_stale_cached_entity_id_is_re_resolved(self, mock_hass, mock_entry):
        """An entity rename must not silently disable the catch-up path."""
        engine = _make_engine(mock_hass, mock_entry)
        engine._active_entity_id = "switch.old_name"
        engine._find_entity = MagicMock(return_value="switch.new_name")
        mock_hass.states.get = MagicMock(
            side_effect=lambda eid: (
                make_state("on") if eid == "switch.new_name" else None
            )
        )

        assert engine._emergency_active() is True
        assert engine._active_entity_id == "switch.new_name"

    def test_no_active_entity_means_no_emergency(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        assert engine._emergency_active() is False


# =========================================================================
# Engine: catching up on a restore that produced no binary-sensor edge
# =========================================================================


class TestEvaluateGridSource:
    def _engine(self, mock_hass, mock_entry, *, emergency=True, started=True):
        engine = _make_engine(mock_hass, mock_entry)
        engine._grace_expires_at = None if started else 10_000.0
        engine._emergency_active = MagicMock(return_value=emergency)
        return engine

    def test_confirmed_on_grid_arms_the_restore(self, mock_hass, mock_entry):
        """The source came back ALREADY reading on-grid — no binary-sensor edge
        ever fires, so without this the devices would stay shed forever."""
        engine = self._engine(mock_hass, mock_entry)
        _grid(mock_hass, "on-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            later.return_value = MagicMock()
            engine._evaluate_grid_source()

        assert later.call_count == 1
        assert engine._restore_debounce_handle is not None

    def test_pending_restore_is_not_rearmed(self, mock_hass, mock_entry):
        """Arm-if-idle: three polling voltage sensors would otherwise reset the
        stability window on every poll and the restore would never fire."""
        engine = self._engine(mock_hass, mock_entry)
        existing = MagicMock()
        engine._restore_debounce_handle = existing
        _grid(mock_hass, "on-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            engine._evaluate_grid_source()

        later.assert_not_called()
        existing.assert_not_called()  # the pending timer was not cancelled either
        assert engine._restore_debounce_handle is existing

    def test_no_emergency_no_action(self, mock_hass, mock_entry):
        engine = self._engine(mock_hass, mock_entry, emergency=False)
        _grid(mock_hass, "on-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            engine._evaluate_grid_source()

        later.assert_not_called()
        assert _notify_calls(mock_hass) == []

    def test_ignored_during_the_startup_grace(self, mock_hass, mock_entry):
        """A stale Modbus value at boot must not restore loads onto the island."""
        engine = self._engine(mock_hass, mock_entry)
        engine._grace_expires_at = 500.0
        _grid(mock_hass, "on-grid")

        with (
            patch(
                "custom_components.battery_guard.automation_engine.async_call_later"
            ) as later,
            patch(
                "custom_components.battery_guard.automation_engine.time"
            ) as mock_time,
        ):
            mock_time.monotonic.return_value = 499.0
            engine._evaluate_grid_source()

        later.assert_not_called()
        assert engine._grace_expires_at == 500.0

    def test_acts_once_the_grace_has_elapsed(self, mock_hass, mock_entry):
        engine = self._engine(mock_hass, mock_entry)
        engine._grace_expires_at = 500.0
        _grid(mock_hass, "on-grid")

        with (
            patch(
                "custom_components.battery_guard.automation_engine.async_call_later"
            ) as later,
            patch(
                "custom_components.battery_guard.automation_engine.time"
            ) as mock_time,
        ):
            later.return_value = MagicMock()
            mock_time.monotonic.return_value = 501.0
            engine._evaluate_grid_source()

        assert later.call_count == 1
        assert engine._grace_expires_at is None

    def test_restore_in_progress_blocks_a_second_arm(self, mock_hass, mock_entry):
        """Guards the window where restore_all already cleared the debounce handle."""
        engine = self._engine(mock_hass, mock_entry)
        engine._restore_in_progress = True
        _grid(mock_hass, "on-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            engine._evaluate_grid_source()

        later.assert_not_called()

    def test_unknown_source_notifies_without_arming(self, mock_hass, mock_entry):
        engine = self._engine(mock_hass, mock_entry)
        _grid(mock_hass, "unavailable")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            engine._evaluate_grid_source()

        later.assert_not_called()
        assert len(_notify_calls(mock_hass)) == 1

    def test_ongoing_outage_stays_silent(self, mock_hass, mock_entry):
        engine = self._engine(mock_hass, mock_entry)
        _grid(mock_hass, "off-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            engine._evaluate_grid_source()

        later.assert_not_called()
        assert _notify_calls(mock_hass) == []

    def test_grace_expiry_triggers_one_evaluation(self, mock_hass, mock_entry):
        """Outage ended while HA was down — no state change will ever arrive."""
        engine = self._engine(mock_hass, mock_entry, started=False)
        engine._grace_handle = MagicMock()
        _grid(mock_hass, "on-grid")

        with patch(
            "custom_components.battery_guard.automation_engine.async_call_later"
        ) as later:
            later.return_value = MagicMock()
            engine._startup_grace_expired(None)

        assert engine._grace_expires_at is None
        assert engine._grace_handle is None
        assert later.call_count == 1


# =========================================================================
# Engine: wiring — the listeners must actually be registered and torn down
# =========================================================================


class TestAsyncStartWiring:
    """Without these, the catch-up logic can be deleted wholesale and every
    behavioural test above still passes."""

    async def _start(self, mock_hass, mock_entry):
        from custom_components.battery_guard.automation_engine import (
            BatteryGuardAutomationEngine,
        )

        engine = BatteryGuardAutomationEngine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        with (
            patch(
                "custom_components.battery_guard.automation_engine"
                ".async_track_state_change_event"
            ) as track,
            patch(
                "custom_components.battery_guard.automation_engine.async_call_later"
            ) as later,
        ):
            track.return_value = MagicMock()
            later.return_value = MagicMock()
            await engine.async_start()
        return engine, track, later

    @pytest.mark.asyncio
    async def test_raw_grid_source_listener_is_registered(self, mock_hass, mock_entry):
        engine, track, _ = await self._start(mock_hass, mock_entry)

        tracked = [c.args[1] for c in track.call_args_list]
        assert [GRID_SENSOR_ENTITY] in tracked

    @pytest.mark.asyncio
    async def test_raw_source_unsub_is_collected_for_teardown(
        self, mock_hass, mock_entry
    ):
        engine, track, _ = await self._start(mock_hass, mock_entry)

        assert track.return_value in engine._unsub_listeners

    @pytest.mark.asyncio
    async def test_startup_grace_is_armed_and_nothing_evaluated_yet(
        self, mock_hass, mock_entry
    ):
        engine, _, later = await self._start(mock_hass, mock_entry)

        assert engine._grace_handle is later.return_value
        assert engine._grace_expires_at is not None
        delays = [c.args[1] for c in later.call_args_list]
        assert RESTORE_STARTUP_GRACE_SECONDS in delays
        # No restore may be armed during setup, whatever the source reports.
        assert engine._restore_debounce_handle is None

    @pytest.mark.asyncio
    async def test_stop_cancels_the_grace_timer_and_all_listeners(
        self, mock_hass, mock_entry
    ):
        engine, track, later = await self._start(mock_hass, mock_entry)
        grace = engine._grace_handle

        await engine.async_stop()

        grace.assert_called_once()
        assert engine._grace_handle is None
        track.return_value.assert_called()
        assert engine._unsub_listeners == []

    @pytest.mark.asyncio
    async def test_no_listener_when_no_grid_source_configured(
        self, mock_hass, mock_entry
    ):
        mock_entry.data = {**mock_entry.data, CONF_GRID_SENSOR: ""}
        engine, track, _ = await self._start(mock_hass, mock_entry)

        tracked = [c.args[1] for c in track.call_args_list]
        assert [] not in tracked
        assert [""] not in tracked


# =========================================================================
# Engine: the voltage path end-to-end (AK6 — "works in BOTH configurations")
# =========================================================================


class TestVoltageModeThroughTheEngine:
    def _engine(self, mock_hass, mock_entry, readings):
        mock_entry.data = {
            **mock_entry.data,
            CONF_USE_VOLTAGE: True,
            CONF_VOLTAGE_PHASE_A: "sensor.a",
            CONF_VOLTAGE_PHASE_B: "sensor.b",
            CONF_VOLTAGE_PHASE_C: "sensor.c",
        }
        mock_hass.states.get = MagicMock(
            side_effect=lambda eid: (
                make_state(readings[eid])
                if eid in readings and readings[eid] is not None
                else None
            )
        )
        return _make_engine(mock_hass, mock_entry)

    def test_all_phases_up_is_on(self, mock_hass, mock_entry):
        engine = self._engine(
            mock_hass,
            mock_entry,
            {"sensor.a": "230.1", "sensor.b": "229.8", "sensor.c": "231.0"},
        )
        assert engine._grid_state() == GRID_ON

    def test_all_phases_down_is_off(self, mock_hass, mock_entry):
        engine = self._engine(
            mock_hass,
            mock_entry,
            {"sensor.a": "0.1", "sensor.b": "0.0", "sensor.c": "0.3"},
        )
        assert engine._grid_state() == GRID_OFF

    def test_two_of_three_phases_back_is_unknown(self, mock_hass, mock_entry):
        """Partial restoration must never authorise a full restore."""
        engine = self._engine(
            mock_hass,
            mock_entry,
            {"sensor.a": "230.1", "sensor.b": "0.2", "sensor.c": "229.5"},
        )
        assert engine._grid_state() == GRID_UNKNOWN

    def test_one_phase_sensor_dropped_out_is_unknown(self, mock_hass, mock_entry):
        engine = self._engine(
            mock_hass,
            mock_entry,
            {"sensor.a": "230.1", "sensor.b": None, "sensor.c": "229.5"},
        )
        assert engine._grid_state() == GRID_UNKNOWN

    def test_exactly_at_the_threshold_counts_as_on(self, mock_hass, mock_entry):
        """Boundary pinned: >= threshold, matching binary_sensor.py detection."""
        volts = str(VOLTAGE_OUTAGE_THRESHOLD)
        engine = self._engine(
            mock_hass,
            mock_entry,
            {"sensor.a": volts, "sensor.b": volts, "sensor.c": volts},
        )
        assert engine._grid_state() == GRID_ON

    def test_incomplete_phase_config_is_unknown(self, mock_hass, mock_entry):
        """Two configured phases must not authorise a restore for all three."""
        mock_entry.data = {
            **mock_entry.data,
            CONF_USE_VOLTAGE: True,
            CONF_VOLTAGE_PHASE_A: "sensor.a",
            CONF_VOLTAGE_PHASE_B: "sensor.b",
            CONF_VOLTAGE_PHASE_C: "",
        }
        mock_hass.states.get = MagicMock(return_value=make_state("230.0"))
        engine = _make_engine(mock_hass, mock_entry)

        assert engine._raw_grid_sources() == []
        assert engine._grid_state() == GRID_UNKNOWN
