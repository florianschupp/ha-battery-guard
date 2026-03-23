"""Tests for Battery Guard services."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.battery_guard.const import DOMAIN, MAX_RETRIES


# =========================================================================
# Action Config Lookup
# =========================================================================


class TestGetActionConfig:
    def test_returns_configured_action(self):
        from custom_components.battery_guard.services import _get_action_config

        device_actions = {
            "climate.ac": {
                "tier1": {"action": "set_hvac_mode", "hvac_mode": "fan_only"},
            }
        }
        result = _get_action_config(device_actions, "climate.ac", "tier1")
        assert result["action"] == "set_hvac_mode"
        assert result["hvac_mode"] == "fan_only"

    def test_returns_default_turn_off(self):
        from custom_components.battery_guard.services import _get_action_config

        result = _get_action_config({}, "switch.heater", "tier1")
        assert result == {"action": "turn_off"}


# =========================================================================
# Retry Logic
# =========================================================================


class TestRetryAction:
    @pytest.mark.asyncio
    async def test_succeeds_first_attempt(self):
        from custom_components.battery_guard.services import _retry_action

        call_count = 0

        async def action():
            nonlocal call_count
            call_count += 1

        await _retry_action(lambda: action(), "switch.heater", "turn_off")
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_succeeds_after_failure(self):
        from custom_components.battery_guard.services import _retry_action

        call_count = 0

        async def action():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise Exception("Transient failure")

        with patch("custom_components.battery_guard.services.asyncio.sleep", new_callable=AsyncMock):
            await _retry_action(lambda: action(), "switch.heater", "turn_off")

        assert call_count == 2

    @pytest.mark.asyncio
    async def test_exhausts_all_attempts(self):
        from custom_components.battery_guard.services import _retry_action

        call_count = 0

        async def action():
            nonlocal call_count
            call_count += 1
            raise Exception("Permanent failure")

        with patch("custom_components.battery_guard.services.asyncio.sleep", new_callable=AsyncMock):
            result = await _retry_action(lambda: action(), "switch.heater", "turn_off")

        assert result is False
        assert call_count == MAX_RETRIES


# =========================================================================
# Execute Action
# =========================================================================


class TestExecuteAction:
    @pytest.mark.asyncio
    async def test_turn_off_calls_homeassistant(self, mock_hass):
        from custom_components.battery_guard.state_store import execute_action

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await execute_action(mock_hass, "switch.heater", {"action": "turn_off"})

        mock_hass.services.async_call.assert_called_once_with(
            "homeassistant",
            "turn_off",
            {},
            target={"entity_id": "switch.heater"},
            blocking=True,
        )

    @pytest.mark.asyncio
    async def test_set_hvac_mode(self, mock_hass):
        from custom_components.battery_guard.state_store import execute_action

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await execute_action(
                mock_hass,
                "climate.ac",
                {"action": "set_hvac_mode", "hvac_mode": "fan_only"},
            )

        mock_hass.services.async_call.assert_called_once_with(
            "climate",
            "set_hvac_mode",
            {"hvac_mode": "fan_only"},
            target={"entity_id": "climate.ac"},
            blocking=True,
        )

    @pytest.mark.asyncio
    async def test_dim_light(self, mock_hass):
        from custom_components.battery_guard.state_store import execute_action

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await execute_action(
                mock_hass,
                "light.desk",
                {"action": "dim", "brightness": 25},
            )

        mock_hass.services.async_call.assert_called_once_with(
            "light",
            "turn_on",
            {"brightness_pct": 25},
            target={"entity_id": "light.desk"},
            blocking=True,
        )

    @pytest.mark.asyncio
    async def test_simulation_mode_skips(self, mock_hass):
        from custom_components.battery_guard.state_store import execute_action

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=True,
        ):
            await execute_action(mock_hass, "switch.heater", {"action": "turn_off"})

        mock_hass.services.async_call.assert_not_called()
