"""State store for Battery Guard — captures and restores device states.

Before any tier action modifies a device, its current state is saved here.
On restore (grid power returns), devices are returned to their exact previous
state using domain-specific service calls.

Storage is in-memory (hass.data). If HA restarts during an outage, saved
states are lost and restore falls back to generic turn_on.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.const import STATE_OFF, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Which attributes to snapshot per domain
_DOMAIN_ATTRIBUTES: dict[str, list[str]] = {
    "climate": [
        "hvac_mode",
        "temperature",
        "target_temp_high",
        "target_temp_low",
        "fan_mode",
        "preset_mode",
    ],
    "light": [
        "brightness",
        "color_temp",
        "color_temp_kelvin",
        "hs_color",
        "rgb_color",
        "xy_color",
        "color_mode",
    ],
    "media_player": [
        "volume_level",
        "source",
    ],
}


class StateStore:
    """In-memory store for pre-action device states."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the state store."""
        self.hass = hass
        self._states: dict[str, dict[str, Any]] = {}

    def save_state(self, entity_id: str) -> None:
        """Capture the current state of a device.

        First save wins: if a state was already saved for this entity
        (e.g., by a previous tier action), it is NOT overwritten.
        This preserves the original pre-outage state.
        """
        if entity_id in self._states:
            _LOGGER.debug(
                "State already saved for %s — keeping original", entity_id
            )
            return

        state = self.hass.states.get(entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            _LOGGER.warning("Cannot save state for %s — unavailable", entity_id)
            return

        domain = entity_id.split(".")[0]
        attrs_to_save = _DOMAIN_ATTRIBUTES.get(domain, [])

        saved: dict[str, Any] = {
            "state": state.state,
            "attributes": {},
        }

        for attr in attrs_to_save:
            value = state.attributes.get(attr)
            if value is not None:
                saved["attributes"][attr] = value

        self._states[entity_id] = saved
        _LOGGER.debug("Saved state for %s: %s", entity_id, saved["state"])

    def get_saved_state(self, entity_id: str) -> dict[str, Any] | None:
        """Get the saved state for a device, or None if not saved."""
        return self._states.get(entity_id)

    def clear_state(self, entity_id: str) -> None:
        """Clear the saved state for a single device."""
        self._states.pop(entity_id, None)

    def clear_all(self) -> None:
        """Clear all saved states (after full restore)."""
        count = len(self._states)
        self._states.clear()
        if count:
            _LOGGER.info("Cleared %d saved device states", count)

    @property
    def has_saved_states(self) -> bool:
        """Return True if any states are saved."""
        return bool(self._states)


async def execute_action(
    hass: HomeAssistant, entity_id: str, action_config: dict[str, Any]
) -> None:
    """Execute a specific action on a device.

    action_config examples:
        {"action": "turn_off"}
        {"action": "set_hvac_mode", "hvac_mode": "fan_only"}
        {"action": "set_temperature", "temperature": 18.0}
        {"action": "dim", "brightness": 25}
    """
    action = action_config.get("action", "turn_off")
    domain = entity_id.split(".")[0]

    if action == "turn_off":
        await hass.services.async_call(
            "homeassistant",
            "turn_off",
            {},
            target={"entity_id": entity_id},
            blocking=True,
        )
    elif action == "turn_on":
        await hass.services.async_call(
            "homeassistant",
            "turn_on",
            {},
            target={"entity_id": entity_id},
            blocking=True,
        )
    elif action == "set_hvac_mode" and domain == "climate":
        hvac_mode = action_config.get("hvac_mode", "fan_only")
        await hass.services.async_call(
            "climate",
            "set_hvac_mode",
            {"hvac_mode": hvac_mode},
            target={"entity_id": entity_id},
            blocking=True,
        )
    elif action == "set_temperature" and domain == "climate":
        temperature = action_config.get("temperature", 18.0)
        await hass.services.async_call(
            "climate",
            "set_temperature",
            {"temperature": temperature},
            target={"entity_id": entity_id},
            blocking=True,
        )
    elif action == "dim" and domain == "light":
        brightness_pct = action_config.get("brightness", 25)
        await hass.services.async_call(
            "light",
            "turn_on",
            {"brightness_pct": brightness_pct},
            target={"entity_id": entity_id},
            blocking=True,
        )
    else:
        _LOGGER.warning(
            "Unknown action '%s' for %s — falling back to turn_off",
            action,
            entity_id,
        )
        await hass.services.async_call(
            "homeassistant",
            "turn_off",
            {},
            target={"entity_id": entity_id},
            blocking=True,
        )


async def restore_state(
    hass: HomeAssistant, entity_id: str, saved: dict[str, Any]
) -> None:
    """Restore a device to its previously saved state.

    Uses domain-specific service calls to restore attributes like
    hvac_mode, temperature, brightness, etc.
    """
    domain = entity_id.split(".")[0]
    saved_state = saved.get("state", "on")
    attrs = saved.get("attributes", {})

    # If device was off before the outage, turn it off
    if saved_state == STATE_OFF:
        await hass.services.async_call(
            "homeassistant",
            "turn_off",
            {},
            target={"entity_id": entity_id},
            blocking=True,
        )
        return

    if domain == "climate":
        # Restore HVAC mode (this also turns the device on)
        hvac_mode = attrs.get("hvac_mode", saved_state)
        if hvac_mode and hvac_mode != STATE_OFF:
            await hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {"hvac_mode": hvac_mode},
                target={"entity_id": entity_id},
                blocking=True,
            )
        # Restore temperature
        if "temperature" in attrs:
            await hass.services.async_call(
                "climate",
                "set_temperature",
                {"temperature": attrs["temperature"]},
                target={"entity_id": entity_id},
                blocking=True,
            )
        # Restore fan mode if available
        if "fan_mode" in attrs:
            try:
                await hass.services.async_call(
                    "climate",
                    "set_fan_mode",
                    {"fan_mode": attrs["fan_mode"]},
                    target={"entity_id": entity_id},
                    blocking=True,
                )
            except Exception:
                _LOGGER.debug(
                    "Could not restore fan_mode for %s", entity_id
                )

    elif domain == "light":
        service_data: dict[str, Any] = {}
        if "brightness" in attrs:
            service_data["brightness"] = attrs["brightness"]
        if "color_temp_kelvin" in attrs:
            service_data["color_temp_kelvin"] = attrs["color_temp_kelvin"]
        elif "color_temp" in attrs:
            service_data["color_temp"] = attrs["color_temp"]
        elif "hs_color" in attrs:
            service_data["hs_color"] = attrs["hs_color"]
        elif "rgb_color" in attrs:
            service_data["rgb_color"] = attrs["rgb_color"]

        await hass.services.async_call(
            "light",
            "turn_on",
            service_data,
            target={"entity_id": entity_id},
            blocking=True,
        )

    else:
        # Generic restore: just turn on
        await hass.services.async_call(
            "homeassistant",
            "turn_on",
            {},
            target={"entity_id": entity_id},
            blocking=True,
        )
