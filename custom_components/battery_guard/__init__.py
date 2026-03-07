"""Battery Guard — Emergency Power Management for Home Assistant."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_DEVICE_ACTIONS,
    CONF_RESTORE_CONFIG,
    DEFAULT_RESTORE_CONFIG,
    DOMAIN,
    PLATFORMS,
)
from .state_store import StateStore

_LOGGER = logging.getLogger(__name__)

type BatteryGuardConfigEntry = ConfigEntry


async def async_migrate_entry(
    hass: HomeAssistant, config_entry: ConfigEntry
) -> bool:
    """Migrate config entry from older versions.

    v1 → v2: Initialize device_actions in options.
    v2 → v3: Initialize restore_config in options.
    """
    _LOGGER.info(
        "Migrating Battery Guard config entry from version %s",
        config_entry.version,
    )

    if config_entry.version < 2:
        new_options = {
            **config_entry.options,
            CONF_DEVICE_ACTIONS: config_entry.options.get(CONF_DEVICE_ACTIONS, {}),
        }
        hass.config_entries.async_update_entry(
            config_entry, options=new_options, version=2
        )
        _LOGGER.info("Migration to version 2 complete")

    if config_entry.version < 3:
        new_options = {
            **config_entry.options,
            CONF_RESTORE_CONFIG: config_entry.options.get(
                CONF_RESTORE_CONFIG, DEFAULT_RESTORE_CONFIG
            ),
        }
        hass.config_entries.async_update_entry(
            config_entry, options=new_options, version=3
        )
        _LOGGER.info("Migration to version 3 complete")

    return True


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Battery Guard integration from YAML (legacy)."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: BatteryGuardConfigEntry
) -> bool:
    """Set up Battery Guard from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "config": entry.data,
    }

    # Ensure Battery Guard labels exist and store their actual HA IDs
    from .labels import async_ensure_labels

    label_map = await async_ensure_labels(hass)
    hass.data[DOMAIN]["label_map"] = label_map

    # Initialize state store for saving/restoring device states
    state_store = StateStore(hass)
    hass.data[DOMAIN]["state_store"] = state_store

    # Set up coordinator for unassigned device counting
    from .coordinator import BatteryGuardCoordinator

    coordinator = BatteryGuardCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN][entry.entry_id]["coordinator"] = coordinator

    # Forward setup to entity platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Set up services
    from .services import async_setup_services

    await async_setup_services(hass, entry)

    # Register WebSocket API for wizard frontend
    from .websocket_api import async_register_websocket_api

    async_register_websocket_api(hass, entry)

    # Start automation engine
    from .automation_engine import BatteryGuardAutomationEngine

    engine = BatteryGuardAutomationEngine(hass, entry)
    await engine.async_start()
    hass.data[DOMAIN][entry.entry_id]["engine"] = engine

    # Register panel
    from .panel import async_register_panel

    await async_register_panel(hass)

    _LOGGER.info("Battery Guard integration loaded")
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: BatteryGuardConfigEntry
) -> bool:
    """Unload a Battery Guard config entry."""
    # Stop automation engine
    data = hass.data[DOMAIN].get(entry.entry_id)
    if data and "engine" in data:
        await data["engine"].async_stop()

    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Unregister panel
    from .panel import async_unregister_panel

    await async_unregister_panel(hass)

    # Clean up services
    from .services import async_unload_services

    await async_unload_services(hass)

    # Remove stored data
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)

    return unload_ok
