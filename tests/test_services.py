"""Tests for Battery Guard services."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.battery_guard.const import DOMAIN, LABEL_TIER1, MAX_RETRIES
from tests.conftest import MockEntityEntry, make_state


# =========================================================================
# Action Label Formatting
# =========================================================================


class TestFormatActionLabel:
    def test_turn_off(self):
        from custom_components.battery_guard.services import _format_action_label

        assert _format_action_label({"action": "turn_off"}) == "off"

    def test_set_hvac_mode(self):
        from custom_components.battery_guard.services import _format_action_label

        result = _format_action_label(
            {"action": "set_hvac_mode", "hvac_mode": "fan_only"}
        )
        assert result == "HVAC → fan_only"

    def test_dim(self):
        from custom_components.battery_guard.services import _format_action_label

        result = _format_action_label({"action": "dim", "brightness": 25})
        assert result == "dim → 25%"

    def test_set_temperature(self):
        from custom_components.battery_guard.services import _format_action_label

        result = _format_action_label({"action": "set_temperature", "temperature": 18})
        assert result == "temp → 18°"

    def test_default(self):
        from custom_components.battery_guard.services import _format_action_label

        assert _format_action_label({}) == "off"


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

        with patch(
            "custom_components.battery_guard.services.asyncio.sleep",
            new_callable=AsyncMock,
        ):
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

        with patch(
            "custom_components.battery_guard.services.asyncio.sleep",
            new_callable=AsyncMock,
        ):
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


# =========================================================================
# handle_tier_off — honest shed classification (#56, Part 3)
# =========================================================================


def _handler_for(mock_hass, service_name):
    """Return the handler registered for a Battery Guard service name."""
    for c in mock_hass.services.async_register.call_args_list:
        if c.args[1] == service_name:
            return c.args[2]
    raise AssertionError(f"service {service_name} not registered")


async def _run_tier_off(mock_hass, monkeypatch, members, states):
    """Register services, drive handle_tier_off over ``members``, return the result."""
    import custom_components.battery_guard.services as svc

    mock_hass.states.get.side_effect = lambda eid: states.get(eid)
    monkeypatch.setattr(svc, "resolve_label_id", lambda hass, tier: "label_tier1")
    svc.er.async_get = MagicMock(return_value=MagicMock())
    svc.er.async_entries_for_label = MagicMock(
        return_value=[MockEntityEntry(eid) for eid in members]
    )
    exec_spy = AsyncMock()
    monkeypatch.setattr(svc, "execute_action", exec_spy)

    await svc.async_setup_services(mock_hass, MagicMock())
    handler = _handler_for(mock_hass, "tier_off")
    call = MagicMock()
    call.data = {"tier": LABEL_TIER1}
    await handler(call)

    return mock_hass.data[DOMAIN]["last_action_result"], exec_spy


class TestHandleTierOffClassification:
    @pytest.mark.asyncio
    async def test_unavailable_device_is_unreachable_not_shed(
        self, mock_hass, monkeypatch
    ):
        result, exec_spy = await _run_tier_off(
            mock_hass,
            monkeypatch,
            members=["switch.live", "switch.dead"],
            states={
                "switch.live": make_state("on"),
                "switch.dead": make_state("unavailable"),
            },
        )
        # The dead device is reported unreachable, never counted as a successful shed.
        assert result["unreachable"] == ["switch.dead"]
        assert result["failed"] == []
        assert result["total"] == 2
        # Only the live device contributes to the action breakdown.
        assert result["action_counts"] == {"off": 1}

    @pytest.mark.asyncio
    async def test_unreachable_attempted_once_no_retry_storm(
        self, mock_hass, monkeypatch
    ):
        result, exec_spy = await _run_tier_off(
            mock_hass,
            monkeypatch,
            members=["switch.dead"],
            states={"switch.dead": make_state("unavailable")},
        )
        called = [c.args[1] for c in exec_spy.await_args_list]
        # Best-effort: attempted exactly once, not retried (no delay on dead devices).
        assert called == ["switch.dead"]

    @pytest.mark.asyncio
    async def test_unknown_state_also_unreachable(self, mock_hass, monkeypatch):
        result, _ = await _run_tier_off(
            mock_hass,
            monkeypatch,
            members=["switch.x"],
            states={"switch.x": make_state("unknown")},
        )
        assert result["unreachable"] == ["switch.x"]

    @pytest.mark.asyncio
    async def test_missing_state_is_unreachable(self, mock_hass, monkeypatch):
        result, _ = await _run_tier_off(
            mock_hass,
            monkeypatch,
            members=["switch.gone"],
            states={},  # entity has no state at all
        )
        assert result["unreachable"] == ["switch.gone"]

    @pytest.mark.asyncio
    async def test_all_available_no_unreachable(self, mock_hass, monkeypatch):
        result, _ = await _run_tier_off(
            mock_hass,
            monkeypatch,
            members=["switch.a", "switch.b"],
            states={"switch.a": make_state("on"), "switch.b": make_state("off")},
        )
        assert result["unreachable"] == []
        assert result["failed"] == []
        assert result["action_counts"] == {"off": 2}
