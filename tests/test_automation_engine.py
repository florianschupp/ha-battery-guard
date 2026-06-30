"""Tests for Battery Guard AutomationEngine."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.battery_guard.const import (
    CONF_BATTERY_OPTIMIZATION,
    CONF_SOC_SENSOR,
    CONF_CRITICAL_SOC,
    DEFAULT_BATTERY_OPTIMIZATION,
    DOMAIN,
    LABEL_TIER1,
    LABEL_TIER2,
)
from tests.conftest import MockState, make_state


def _make_engine(mock_hass, mock_entry):
    """Create an AutomationEngine with mocked hass/entry."""
    with patch(
        "custom_components.battery_guard.automation_engine.async_track_state_change_event"
    ):
        from custom_components.battery_guard.automation_engine import (
            BatteryGuardAutomationEngine,
        )

        engine = BatteryGuardAutomationEngine(mock_hass, mock_entry)
    return engine


# =========================================================================
# Pure Helpers
# =========================================================================


class TestFormatDuration:
    def test_minutes(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._format_duration(300) == "5 min"

    def test_hours_and_minutes(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._format_duration(5400) == "1h 30min"

    def test_exact_hours(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._format_duration(7200) == "2h"

    def test_zero(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        assert engine._format_duration(0) == "0 min"


class TestFormatActionResult:
    def test_all_success(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        result = engine._format_action_result(6, [])
        assert "✅" in result
        assert "6 devices" in result

    def test_with_failures(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        mock_hass.states.get.return_value = make_state(
            "on", {"friendly_name": "Heater"}
        )
        result = engine._format_action_result(6, ["switch.heater"])
        assert "⚠️" in result
        assert "5/6" in result
        assert "Heater" in result

    def test_with_action_counts(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        counts = {"off": 3, "HVAC → fan_only": 1, "dim → 25%": 1}
        result = engine._format_action_result(5, [], counts)
        assert "✅" in result
        assert "3× off" in result
        assert "HVAC → fan_only" in result
        assert "dim → 25%" in result

    def test_without_action_counts(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        result = engine._format_action_result(3, [])
        assert "✅ 3 devices" in result
        assert "(" not in result


class TestFriendlyName:
    def test_returns_attribute(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        mock_hass.states.get.return_value = make_state(
            "on", {"friendly_name": "Living Room AC"}
        )
        assert engine._friendly_name("climate.living_room") == "Living Room AC"

    def test_falls_back_to_entity_id(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        mock_hass.states.get.return_value = None
        assert engine._friendly_name("switch.unknown") == "switch.unknown"


# =========================================================================
# Battery Optimization
# =========================================================================


class TestBatteryOptimization:
    @pytest.mark.asyncio
    async def test_disabled_does_nothing(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {"enabled": False, "entities": []}
        engine = _make_engine(mock_hass, mock_entry)

        await engine._apply_battery_optimization("outage")
        mock_hass.services.async_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_sets_outage_values(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {
            "enabled": True,
            "entities": [
                {
                    "entity_id": "number.charge_limit",
                    "normal_value": 90,
                    "outage_value": 100,
                }
            ],
        }
        mock_hass.states.get.return_value = make_state("90")
        engine = _make_engine(mock_hass, mock_entry)

        await engine._apply_battery_optimization("outage")

        mock_hass.services.async_call.assert_called_once_with(
            "number",
            "set_value",
            {"value": 100.0},
            target={"entity_id": "number.charge_limit"},
            blocking=True,
        )

    @pytest.mark.asyncio
    async def test_sets_normal_values(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {
            "enabled": True,
            "entities": [
                {
                    "entity_id": "number.charge_limit",
                    "normal_value": 90,
                    "outage_value": 100,
                }
            ],
        }
        mock_hass.states.get.return_value = make_state("100")
        engine = _make_engine(mock_hass, mock_entry)

        await engine._apply_battery_optimization("normal")

        mock_hass.services.async_call.assert_called_once_with(
            "number",
            "set_value",
            {"value": 90.0},
            target={"entity_id": "number.charge_limit"},
            blocking=True,
        )

    @pytest.mark.asyncio
    async def test_skips_unavailable_entity(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {
            "enabled": True,
            "entities": [
                {
                    "entity_id": "number.charge_limit",
                    "normal_value": 90,
                    "outage_value": 100,
                }
            ],
        }
        mock_hass.states.get.return_value = make_state("unavailable")
        engine = _make_engine(mock_hass, mock_entry)

        await engine._apply_battery_optimization("outage")
        mock_hass.services.async_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_exception_gracefully(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {
            "enabled": True,
            "entities": [
                {
                    "entity_id": "number.charge_limit",
                    "normal_value": 90,
                    "outage_value": 100,
                }
            ],
        }
        mock_hass.states.get.return_value = make_state("90")
        mock_hass.services.async_call.side_effect = Exception("Service failed")
        engine = _make_engine(mock_hass, mock_entry)

        # Should not raise
        await engine._apply_battery_optimization("outage")

    @pytest.mark.asyncio
    async def test_multiple_entities(self, mock_hass, mock_entry):
        mock_entry.data[CONF_BATTERY_OPTIMIZATION] = {
            "enabled": True,
            "entities": [
                {
                    "entity_id": "number.charge_limit",
                    "normal_value": 90,
                    "outage_value": 100,
                },
                {
                    "entity_id": "number.discharge_limit",
                    "normal_value": 20,
                    "outage_value": 10,
                },
            ],
        }
        mock_hass.states.get.return_value = make_state("50")
        engine = _make_engine(mock_hass, mock_entry)

        await engine._apply_battery_optimization("outage")
        assert mock_hass.services.async_call.call_count == 2


# =========================================================================
# Outage / Restore Flow
# =========================================================================


class TestOutageFlow:
    @pytest.mark.asyncio
    async def test_on_power_outage_sets_active_and_calls_tier_off(
        self, mock_hass, mock_entry
    ):
        engine = _make_engine(mock_hass, mock_entry)
        # Mock _find_entity to return an active switch
        engine._find_entity = MagicMock(return_value="switch.battery_guard_active")
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 3, "failed": []}}

        await engine._on_power_outage()

        # Check active switch was turned on
        calls = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == "switch" and c.args[1] == "turn_on"
        ]
        assert len(calls) == 1

        # Check tier_off was called
        tier_off_calls = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "tier_off"
        ]
        assert len(tier_off_calls) == 1

    @pytest.mark.asyncio
    async def test_on_power_outage_tracks_start_time(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 0, "failed": []}}

        assert engine._outage_start_time is None
        await engine._on_power_outage()
        assert engine._outage_start_time is not None

    @pytest.mark.asyncio
    async def test_on_power_outage_sends_notification(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 5, "failed": []}}

        await engine._on_power_outage()

        notify_calls = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "notify"
        ]
        assert len(notify_calls) == 1
        assert notify_calls[0].args[2]["title"] == "⚡ Power Outage Detected"

    @pytest.mark.asyncio
    async def test_on_power_outage_skips_when_already_active(
        self, mock_hass, mock_entry
    ):
        # Re-entry guard (#45): re-firing while an outage is already in progress
        # (in-process _outage_start_time set) must NOT re-shed or re-notify.
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        engine._outage_start_time = 123.0  # outage already in progress
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}

        await engine._on_power_outage()

        mock_hass.services.async_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_power_outage_skips_when_active_switch_on(
        self, mock_hass, mock_entry
    ):
        # Secondary layer: active switch on (e.g. restored across a reboot)
        # also blocks re-entry even if _outage_start_time is None.
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        engine._outage_start_time = None
        engine._get_switch_state = MagicMock(return_value=True)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}

        await engine._on_power_outage()

        mock_hass.services.async_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_power_outage_proceeds_when_not_active(
        self, mock_hass, mock_entry
    ):
        # Counter-case: the guard does NOT over-block a genuine fresh outage.
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        engine._outage_start_time = None
        engine._get_switch_state = MagicMock(return_value=False)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}

        await engine._on_power_outage()

        assert any(
            c.args[0] == DOMAIN and c.args[1] == "notify"
            for c in mock_hass.services.async_call.call_args_list
        )


class TestRestoreFlow:
    @pytest.mark.asyncio
    async def test_on_grid_restored_calls_restore_all(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)
        mock_hass.data[DOMAIN] = {
            "last_action_result": {"total": 5, "failed": []},
        }

        await engine._on_grid_restored()

        restore_calls = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "restore_all"
        ]
        assert len(restore_calls) == 1

    @pytest.mark.asyncio
    async def test_on_grid_restored_calculates_duration(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=True)
        engine._outage_start_time = 1000.0
        mock_hass.data[DOMAIN] = {
            "last_action_result": {"total": 0, "failed": []},
        }

        with patch("custom_components.battery_guard.automation_engine.time") as mock_time:
            mock_time.monotonic.return_value = 4600.0  # 1 hour later
            await engine._on_grid_restored()

        # Outage start time should be reset
        assert engine._outage_start_time is None

        # Notification should contain duration
        notify_calls = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "notify"
        ]
        assert len(notify_calls) == 1
        assert "duration" in notify_calls[0].args[2]["message"].lower()

    @pytest.mark.asyncio
    async def test_on_grid_restored_skips_if_not_active(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._get_switch_state = MagicMock(return_value=False)

        await engine._on_grid_restored()

        # No service calls should be made
        mock_hass.services.async_call.assert_not_called()


class TestLevelBasedOutageStart:
    """Issue #53 — outage that begins ALREADY below the thresholds."""

    def _setup(self, engine, mock_hass, *, soc, tier2_disabled=False, critical=10, t2=30):
        engine._find_entity = MagicMock(return_value=None)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}
        engine._shed_tier2_locked = AsyncMock()
        engine._on_critical_soc = AsyncMock()
        engine._get_soc_value = MagicMock(return_value=soc)
        engine._get_threshold = MagicMock(return_value=t2)
        engine._get_switch_state = MagicMock(return_value=tier2_disabled)
        engine._critical_soc = critical

    @pytest.mark.asyncio
    async def test_below_tier2_sheds_tier2_no_alarm(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=20)  # < t2=30, > critical=10
        await engine._on_power_outage()
        engine._shed_tier2_locked.assert_awaited_once()
        engine._on_critical_soc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_below_critical_sheds_and_alarms(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=8)  # < critical=10
        await engine._on_power_outage()
        engine._shed_tier2_locked.assert_awaited_once()
        engine._on_critical_soc.assert_awaited_once()
        assert engine._critical_alerted is True

    @pytest.mark.asyncio
    async def test_healthy_soc_no_level_action(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=50)  # >= t2
        await engine._on_power_outage()
        engine._shed_tier2_locked.assert_not_awaited()
        engine._on_critical_soc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_tier2_already_disabled_not_reshed(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=20, tier2_disabled=True)
        await engine._on_power_outage()
        engine._shed_tier2_locked.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_soc_unavailable_no_level_action(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=None)
        await engine._on_power_outage()  # must not raise
        engine._shed_tier2_locked.assert_not_awaited()
        engine._on_critical_soc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_critical_alarm_deduped_on_reentry(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        self._setup(engine, mock_hass, soc=8)
        await engine._on_power_outage()
        await engine._on_power_outage()  # re-entry, no active-off between
        assert engine._on_critical_soc.await_count == 1

    @pytest.mark.asyncio
    async def test_real_tier2_shed_under_lock_no_deadlock(self, mock_hass, mock_entry):
        # Runs the REAL _shed_tier2_locked while _on_power_outage holds the
        # non-reentrant lock — a re-introduced `async with self._operation_lock`
        # in the helper would hang here (caught by wait_for), not pass silently.
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}
        engine._get_soc_value = MagicMock(return_value=20)  # < t2=30, > critical
        engine._get_threshold = MagicMock(return_value=30)
        engine._get_switch_state = MagicMock(return_value=False)
        engine._critical_soc = 10

        await asyncio.wait_for(engine._on_power_outage(), timeout=2.0)

        tier_off = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "tier_off"
        ]
        assert len(tier_off) == 2  # TIER1 + TIER2
        notify = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "notify"
        ]
        assert len(notify) == 2  # outage + tier-2

    @pytest.mark.asyncio
    async def test_tier2_not_reshed_on_reentry_with_propagation(
        self, mock_hass, mock_entry
    ):
        # tier2_disabled flips True after the first shed; the second outage-start
        # must read the propagated state and skip re-shedding.
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(return_value=None)
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 1, "failed": []}}
        engine._get_soc_value = MagicMock(return_value=20)
        engine._get_threshold = MagicMock(return_value=30)
        engine._on_critical_soc = AsyncMock()
        engine._critical_soc = 10

        sw = {"tier2_disabled": False}
        engine._get_switch_state = MagicMock(side_effect=lambda k: sw.get(k, False))

        async def fake_shed(soc, threshold):
            sw["tier2_disabled"] = True

        engine._shed_tier2_locked = AsyncMock(side_effect=fake_shed)

        await engine._on_power_outage()
        await engine._on_power_outage()  # tier2_disabled now True → skip
        assert engine._shed_tier2_locked.await_count == 1


class TestCrossingCriticalGuard:
    """Issue #53 — the flag-guarded crossing critical branch still fires once."""

    def _event(self, old, new):
        ev = MagicMock()
        ev.data = {"old_state": make_state(old), "new_state": make_state(new)}
        return ev

    def test_first_crossing_fires_and_sets_flag(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_soc = 10
        engine._critical_alerted = False
        engine._get_switch_state = MagicMock(return_value=True)  # active
        engine._get_threshold = MagicMock(return_value=30)
        engine._on_critical_soc = MagicMock()

        engine._handle_soc_change(self._event("11", "9"))  # crosses critical

        engine._on_critical_soc.assert_called_once()
        assert engine._critical_alerted is True

    def test_second_crossing_deduped(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_soc = 10
        engine._critical_alerted = True  # already alerted this emergency
        engine._get_switch_state = MagicMock(return_value=True)
        engine._get_threshold = MagicMock(return_value=30)
        engine._on_critical_soc = MagicMock()

        engine._handle_soc_change(self._event("11", "9"))

        engine._on_critical_soc.assert_not_called()


class TestCriticalAlarmRearm:
    """Issue #53 — _critical_alerted resets when emergency ends (active → off)."""

    def _event(self, new_state):
        ev = MagicMock()
        ev.data = {"new_state": new_state}
        return ev

    def test_active_off_resets_flag(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_alerted = True
        engine._handle_active_change(self._event(make_state("off")))
        assert engine._critical_alerted is False

    def test_active_on_keeps_flag(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_alerted = True
        engine._handle_active_change(self._event(make_state("on")))
        assert engine._critical_alerted is True

    def test_active_none_keeps_flag(self, mock_hass, mock_entry):
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_alerted = True
        engine._handle_active_change(self._event(None))
        assert engine._critical_alerted is True

    def test_active_unavailable_does_not_rearm(self, mock_hass, mock_entry):
        # A transient unavailable of the active switch mid-emergency must NOT
        # re-arm the alarm (else duplicate critical alarms).
        engine = _make_engine(mock_hass, mock_entry)
        engine._critical_alerted = True
        engine._handle_active_change(self._event(make_state("unavailable")))
        assert engine._critical_alerted is True


class TestTier2ShedRefactor:
    """Issue #53 — extracted _shed_tier2_locked keeps the crossing path working."""

    @pytest.mark.asyncio
    async def test_on_soc_below_threshold_still_sheds_tier2(
        self, mock_hass, mock_entry
    ):
        engine = _make_engine(mock_hass, mock_entry)
        engine._find_entity = MagicMock(
            return_value="switch.battery_guard_tier2_disabled"
        )
        mock_hass.data[DOMAIN] = {"last_action_result": {"total": 2, "failed": []}}

        await engine._on_soc_below_threshold(25.0, 30.0)

        tier_off = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "tier_off"
        ]
        assert len(tier_off) == 1
        assert tier_off[0].args[2]["tier"] == LABEL_TIER2

        notify = [
            c
            for c in mock_hass.services.async_call.call_args_list
            if c.args[0] == DOMAIN and c.args[1] == "notify"
        ]
        assert len(notify) == 1
        assert notify[0].args[2]["title"] == "🔋 Low Battery — Tier 2 Off"
