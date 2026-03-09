"""WebSocket API for Battery Guard.

Provides commands for the wizard frontend to read and write
per-device action configurations stored in config entry options.

Commands:
    battery_guard/get_device_actions → returns current device_actions map
    battery_guard/set_device_actions → updates device_actions in entry options
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import CONF_DEVICE_ACTIONS, CONF_RESTORE_CONFIG, DEFAULT_RESTORE_CONFIG, DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_api(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Register WebSocket API commands."""
    websocket_api.async_register_command(hass, ws_get_version)
    websocket_api.async_register_command(hass, ws_get_device_actions)
    websocket_api.async_register_command(hass, ws_set_device_actions)
    websocket_api.async_register_command(hass, ws_get_restore_config)
    websocket_api.async_register_command(hass, ws_set_restore_config)
    _LOGGER.debug("Registered Battery Guard WebSocket API commands")


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/get_version",
    }
)
@callback
def ws_get_version(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current Battery Guard version."""
    connection.send_result(msg["id"], {"version": VERSION})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/get_device_actions",
    }
)
@callback
def ws_get_device_actions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current device_actions configuration."""
    device_actions: dict[str, Any] = {}

    # Find the Battery Guard config entry
    for entry in hass.config_entries.async_entries(DOMAIN):
        device_actions = entry.options.get(CONF_DEVICE_ACTIONS, {})
        break

    connection.send_result(msg["id"], {"device_actions": device_actions})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/set_device_actions",
        vol.Required("device_actions"): dict,
    }
)
@websocket_api.async_response
async def ws_set_device_actions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update the device_actions configuration in config entry options."""
    new_device_actions = msg["device_actions"]

    # Find the Battery Guard config entry
    entry: ConfigEntry | None = None
    for e in hass.config_entries.async_entries(DOMAIN):
        entry = e
        break

    if entry is None:
        connection.send_error(
            msg["id"], "not_found", "Battery Guard config entry not found"
        )
        return

    # Merge with existing options, updating device_actions
    new_options = {**entry.options, CONF_DEVICE_ACTIONS: new_device_actions}
    hass.config_entries.async_update_entry(entry, options=new_options)

    _LOGGER.info(
        "Updated device_actions for %d entities", len(new_device_actions)
    )
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/get_restore_config",
    }
)
@callback
def ws_get_restore_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current restore configuration."""
    restore_config: dict[str, Any] = DEFAULT_RESTORE_CONFIG

    for entry in hass.config_entries.async_entries(DOMAIN):
        restore_config = entry.options.get(CONF_RESTORE_CONFIG, DEFAULT_RESTORE_CONFIG)
        break

    connection.send_result(msg["id"], {"restore_config": restore_config})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/set_restore_config",
        vol.Required("restore_config"): dict,
    }
)
@websocket_api.async_response
async def ws_set_restore_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update the restore configuration in config entry options."""
    new_restore_config = msg["restore_config"]

    entry: ConfigEntry | None = None
    for e in hass.config_entries.async_entries(DOMAIN):
        entry = e
        break

    if entry is None:
        connection.send_error(
            msg["id"], "not_found", "Battery Guard config entry not found"
        )
        return

    new_options = {**entry.options, CONF_RESTORE_CONFIG: new_restore_config}
    hass.config_entries.async_update_entry(entry, options=new_options)

    _LOGGER.info("Updated restore_config")
    connection.send_result(msg["id"], {"success": True})
