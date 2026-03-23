"""Tests for Battery Guard StateStore."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import make_state


# =========================================================================
# FirstSaveWins
# =========================================================================


class TestFirstSaveWins:
    def test_save_state_captures_current_state(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("on")
        state_store.save_state("switch.heater")

        saved = state_store.get_saved_state("switch.heater")
        assert saved is not None
        assert saved["state"] == "on"

    def test_first_save_wins_does_not_overwrite(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("on")
        state_store.save_state("switch.heater")

        # Change state, try to save again
        mock_hass.states.get.return_value = make_state("off")
        state_store.save_state("switch.heater")

        # Original state preserved
        saved = state_store.get_saved_state("switch.heater")
        assert saved["state"] == "on"

    def test_save_different_entities(self, state_store, mock_hass):
        mock_hass.states.get.side_effect = [
            make_state("on"),
            make_state("off"),
        ]
        state_store.save_state("switch.a")
        state_store.save_state("switch.b")

        assert state_store.get_saved_state("switch.a")["state"] == "on"
        assert state_store.get_saved_state("switch.b")["state"] == "off"


# =========================================================================
# Domain Attributes
# =========================================================================


class TestDomainAttributes:
    def test_save_climate_captures_hvac_mode_and_temperature(
        self, state_store, mock_hass
    ):
        mock_hass.states.get.return_value = make_state(
            "cool",
            {"hvac_mode": "cool", "temperature": 22.0, "fan_mode": "auto"},
        )
        state_store.save_state("climate.living_room")

        saved = state_store.get_saved_state("climate.living_room")
        assert saved["attributes"]["hvac_mode"] == "cool"
        assert saved["attributes"]["temperature"] == 22.0
        assert saved["attributes"]["fan_mode"] == "auto"

    def test_save_light_captures_brightness_and_color(
        self, state_store, mock_hass
    ):
        mock_hass.states.get.return_value = make_state(
            "on",
            {"brightness": 200, "color_temp": 350},
        )
        state_store.save_state("light.desk")

        saved = state_store.get_saved_state("light.desk")
        assert saved["attributes"]["brightness"] == 200
        assert saved["attributes"]["color_temp"] == 350

    def test_save_switch_captures_only_state(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state(
            "on", {"friendly_name": "Heater"}
        )
        state_store.save_state("switch.heater")

        saved = state_store.get_saved_state("switch.heater")
        assert saved["state"] == "on"
        # friendly_name is not in _DOMAIN_ATTRIBUTES for switch
        assert saved["attributes"] == {}


# =========================================================================
# Edge Cases
# =========================================================================


class TestEdgeCases:
    def test_save_unavailable_entity_skipped(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("unavailable")
        state_store.save_state("switch.broken")
        assert state_store.get_saved_state("switch.broken") is None

    def test_save_unknown_entity_skipped(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("unknown")
        state_store.save_state("switch.new")
        assert state_store.get_saved_state("switch.new") is None

    def test_save_nonexistent_entity_skipped(self, state_store, mock_hass):
        mock_hass.states.get.return_value = None
        state_store.save_state("switch.ghost")
        assert state_store.get_saved_state("switch.ghost") is None


# =========================================================================
# Restore
# =========================================================================


class TestRestore:
    @pytest.mark.asyncio
    async def test_restore_climate_sets_hvac_mode_then_temperature(self, mock_hass):
        from custom_components.battery_guard.state_store import restore_state

        saved = {
            "state": "cool",
            "attributes": {"hvac_mode": "cool", "temperature": 22.0},
        }

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await restore_state(mock_hass, "climate.ac", saved)

        calls = mock_hass.services.async_call.call_args_list
        # First call: set_hvac_mode
        assert calls[0].args[0] == "climate"
        assert calls[0].args[1] == "set_hvac_mode"
        # Second call: set_temperature
        assert calls[1].args[0] == "climate"
        assert calls[1].args[1] == "set_temperature"

    @pytest.mark.asyncio
    async def test_restore_light_sets_brightness(self, mock_hass):
        from custom_components.battery_guard.state_store import restore_state

        saved = {"state": "on", "attributes": {"brightness": 200}}

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await restore_state(mock_hass, "light.desk", saved)

        call = mock_hass.services.async_call.call_args_list[0]
        assert call.args[0] == "light"
        assert call.args[1] == "turn_on"
        assert call.args[2]["brightness"] == 200

    @pytest.mark.asyncio
    async def test_restore_off_state_turns_off(self, mock_hass):
        from custom_components.battery_guard.state_store import restore_state

        saved = {"state": "off", "attributes": {}}

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await restore_state(mock_hass, "switch.heater", saved)

        call = mock_hass.services.async_call.call_args_list[0]
        assert call.args[0] == "homeassistant"
        assert call.args[1] == "turn_off"

    @pytest.mark.asyncio
    async def test_restore_generic_domain_turns_on(self, mock_hass):
        from custom_components.battery_guard.state_store import restore_state

        saved = {"state": "on", "attributes": {}}

        with patch(
            "custom_components.battery_guard.state_store.is_simulation_mode",
            return_value=False,
        ):
            await restore_state(mock_hass, "switch.heater", saved)

        call = mock_hass.services.async_call.call_args_list[0]
        assert call.args[0] == "homeassistant"
        assert call.args[1] == "turn_on"


# =========================================================================
# Clear
# =========================================================================


class TestClear:
    def test_clear_state_removes_entry(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("on")
        state_store.save_state("switch.a")
        state_store.clear_state("switch.a")
        assert state_store.get_saved_state("switch.a") is None

    def test_clear_all_removes_everything(self, state_store, mock_hass):
        mock_hass.states.get.return_value = make_state("on")
        state_store.save_state("switch.a")
        state_store.save_state("switch.b")
        state_store.clear_all()
        assert not state_store.has_saved_states

    def test_has_saved_states_true_when_states_exist(self, state_store, mock_hass):
        assert not state_store.has_saved_states
        mock_hass.states.get.return_value = make_state("on")
        state_store.save_state("switch.a")
        assert state_store.has_saved_states
