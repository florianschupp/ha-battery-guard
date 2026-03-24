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

from .const import (
    CONF_BATTERY_CHARGE_ENTITY,
    CONF_BATTERY_DISCHARGE_ENTITY,
    CONF_BATTERY_MAX_SOC,
    CONF_BATTERY_MIN_SOC,
    CONF_BATTERY_OPTIMIZATION,
    CONF_CRITICAL_SOC,
    CONF_DEVICE_ACTIONS,
    CONF_GRID_SENSOR,
    CONF_NOTIFY_SERVICES,
    CONF_RECOVERY_THRESHOLD,
    CONF_RESTORE_CONFIG,
    CONF_SOC_SENSOR,
    CONF_TIER2_THRESHOLD,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DEFAULT_BATTERY_MAX_SOC,
    DEFAULT_BATTERY_MIN_SOC,
    DEFAULT_BATTERY_OPTIMIZATION,
    DEFAULT_CRITICAL_SOC,
    DEFAULT_RESTORE_CONFIG,
    DEFAULT_TIER2_RECOVERY_THRESHOLD,
    DEFAULT_TIER2_THRESHOLD,
    DOMAIN,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_api(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register WebSocket API commands."""
    websocket_api.async_register_command(hass, ws_get_version)
    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_set_config)
    websocket_api.async_register_command(hass, ws_get_device_actions)
    websocket_api.async_register_command(hass, ws_set_device_actions)
    websocket_api.async_register_command(hass, ws_get_restore_config)
    websocket_api.async_register_command(hass, ws_set_restore_config)
    websocket_api.async_register_command(hass, ws_export_config)
    websocket_api.async_register_command(hass, ws_import_config)
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
        vol.Required("type"): "battery_guard/get_config",
    }
)
@callback
def ws_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current Battery Guard configuration (thresholds, sensors, notifications)."""
    config: dict[str, Any] = {}

    for entry in hass.config_entries.async_entries(DOMAIN):
        data = entry.data
        config = {
            CONF_SOC_SENSOR: data.get(CONF_SOC_SENSOR, ""),
            CONF_GRID_SENSOR: data.get(CONF_GRID_SENSOR, ""),
            CONF_USE_VOLTAGE: data.get(CONF_USE_VOLTAGE, False),
            CONF_VOLTAGE_PHASE_A: data.get(CONF_VOLTAGE_PHASE_A, ""),
            CONF_VOLTAGE_PHASE_B: data.get(CONF_VOLTAGE_PHASE_B, ""),
            CONF_VOLTAGE_PHASE_C: data.get(CONF_VOLTAGE_PHASE_C, ""),
            CONF_TIER2_THRESHOLD: data.get(
                CONF_TIER2_THRESHOLD, DEFAULT_TIER2_THRESHOLD
            ),
            CONF_RECOVERY_THRESHOLD: data.get(
                CONF_RECOVERY_THRESHOLD, DEFAULT_TIER2_RECOVERY_THRESHOLD
            ),
            CONF_CRITICAL_SOC: data.get(CONF_CRITICAL_SOC, DEFAULT_CRITICAL_SOC),
            CONF_BATTERY_MAX_SOC: data.get(
                CONF_BATTERY_MAX_SOC, DEFAULT_BATTERY_MAX_SOC
            ),
            CONF_BATTERY_MIN_SOC: data.get(
                CONF_BATTERY_MIN_SOC, DEFAULT_BATTERY_MIN_SOC
            ),
            CONF_NOTIFY_SERVICES: data.get(CONF_NOTIFY_SERVICES, []),
            CONF_BATTERY_CHARGE_ENTITY: data.get(CONF_BATTERY_CHARGE_ENTITY, ""),
            CONF_BATTERY_DISCHARGE_ENTITY: data.get(CONF_BATTERY_DISCHARGE_ENTITY, ""),
            CONF_BATTERY_OPTIMIZATION: data.get(
                CONF_BATTERY_OPTIMIZATION, DEFAULT_BATTERY_OPTIMIZATION
            ),
        }
        break

    connection.send_result(msg["id"], {"config": config})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/set_config",
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def ws_set_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update Battery Guard configuration (thresholds, notifications)."""
    new_config = msg["config"]

    entry: ConfigEntry | None = None
    for e in hass.config_entries.async_entries(DOMAIN):
        entry = e
        break

    if entry is None:
        connection.send_error(
            msg["id"], "not_found", "Battery Guard config entry not found"
        )
        return

    # Validate recovery > threshold
    recovery = new_config.get(CONF_RECOVERY_THRESHOLD, DEFAULT_TIER2_RECOVERY_THRESHOLD)
    threshold = new_config.get(CONF_TIER2_THRESHOLD, DEFAULT_TIER2_THRESHOLD)
    if recovery <= threshold:
        connection.send_error(
            msg["id"], "validation_error", "Recovery threshold must exceed T2 threshold"
        )
        return

    # Validate battery optimization config if provided
    if CONF_BATTERY_OPTIMIZATION in new_config:
        opt = new_config[CONF_BATTERY_OPTIMIZATION]
        if not isinstance(opt, dict):
            connection.send_error(
                msg["id"], "validation_error", "battery_optimization must be a dict"
            )
            return
        for entity_cfg in opt.get("entities", []):
            eid = entity_cfg.get("entity_id", "")
            if not eid.startswith("number."):
                connection.send_error(
                    msg["id"],
                    "validation_error",
                    f"Entity {eid} must be a number entity",
                )
                return
            for val_key in ("normal_value", "outage_value"):
                val = entity_cfg.get(val_key)
                if val is not None and not isinstance(val, (int, float)):
                    connection.send_error(
                        msg["id"],
                        "validation_error",
                        f"{val_key} for {eid} must be numeric",
                    )
                    return

    # Merge with existing data, only update allowed fields
    allowed_keys = {
        CONF_TIER2_THRESHOLD,
        CONF_RECOVERY_THRESHOLD,
        CONF_CRITICAL_SOC,
        CONF_BATTERY_MAX_SOC,
        CONF_BATTERY_MIN_SOC,
        CONF_NOTIFY_SERVICES,
        CONF_BATTERY_OPTIMIZATION,
    }
    new_data = {**entry.data}
    for key in allowed_keys:
        if key in new_config:
            new_data[key] = new_config[key]

    hass.config_entries.async_update_entry(entry, data=new_data)

    # Auto-backup before reload (reload destroys current hass.data)
    backup = hass.data.get(DOMAIN, {}).get("config_backup")
    if backup:
        await backup.save(entry)

    await hass.config_entries.async_reload(entry.entry_id)

    _LOGGER.info("Updated Battery Guard config (thresholds/notifications)")
    connection.send_result(msg["id"], {"success": True})


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

    # Auto-backup
    backup = hass.data.get(DOMAIN, {}).get("config_backup")
    if backup:
        await backup.save(entry)

    _LOGGER.info("Updated device_actions for %d entities", len(new_device_actions))
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

    # Auto-backup
    backup = hass.data.get(DOMAIN, {}).get("config_backup")
    if backup:
        await backup.save(entry)

    _LOGGER.info("Updated restore_config")
    connection.send_result(msg["id"], {"success": True})


# ============================================================================
# Config Export / Import
# ============================================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/export_config",
    }
)
@callback
def ws_export_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Export full Battery Guard configuration as JSON."""
    entry: ConfigEntry | None = None
    for e in hass.config_entries.async_entries(DOMAIN):
        entry = e
        break

    if entry is None:
        connection.send_error(
            msg["id"], "not_found", "Battery Guard config entry not found"
        )
        return

    connection.send_result(
        msg["id"],
        {
            "data": dict(entry.data),
            "options": dict(entry.options),
            "version": VERSION,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "battery_guard/import_config",
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def ws_import_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Import Battery Guard configuration from JSON."""
    imported = msg["config"]

    entry: ConfigEntry | None = None
    for e in hass.config_entries.async_entries(DOMAIN):
        entry = e
        break

    if entry is None:
        connection.send_error(
            msg["id"], "not_found", "Battery Guard config entry not found"
        )
        return

    # Validate structure
    if "data" not in imported or not isinstance(imported["data"], dict):
        connection.send_error(
            msg["id"], "validation_error", "Invalid config: missing 'data' dict"
        )
        return

    # Merge imported data into entry (preserve entry-specific fields)
    new_data = {**entry.data, **imported["data"]}
    hass.config_entries.async_update_entry(entry, data=new_data)

    # Merge options if present
    if "options" in imported and isinstance(imported["options"], dict):
        new_options = {**entry.options, **imported["options"]}
        hass.config_entries.async_update_entry(entry, options=new_options)

    # Auto-backup the imported config
    backup = hass.data.get(DOMAIN, {}).get("config_backup")
    if backup:
        await backup.save(entry)

    await hass.config_entries.async_reload(entry.entry_id)

    _LOGGER.info("Imported Battery Guard configuration")
    connection.send_result(msg["id"], {"success": True})
