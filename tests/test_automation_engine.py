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
