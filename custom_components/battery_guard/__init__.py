"""Battery Guard — Emergency Power Management for Home Assistant."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    CONF_BATTERY_MAX_SOC,
    CONF_BATTERY_MIN_SOC,
    CONF_BATTERY_OPTIMIZATION,
    CONF_DEVICE_ACTIONS,
    CONF_RESTORE_CONFIG,
    DEFAULT_BATTERY_MAX_SOC,
    DEFAULT_BATTERY_MIN_SOC,
    DEFAULT_BATTERY_OPTIMIZATION,
    DEFAULT_RESTORE_CONFIG,
    DOMAIN,
    PLATFORMS,
)
from .state_store import StateStore

_LOGGER = logging.getLogger(__name__)

BatteryGuardConfigEntry = ConfigEntry

BACKUP_STORAGE_KEY = "battery_guard.config_backup"
BACKUP_STORAGE_VERSION = 1


class ConfigBackup:
    """Auto-backup config to .storage on every change."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize config backup."""
        self._hass = hass
        self._store: Store = Store(hass, BACKUP_STORAGE_VERSION, BACKUP_STORAGE_KEY)

    async def save(self, entry: ConfigEntry) -> None:
        """Save current config as backup, including DeviceConfigStore contents."""
        from homeassistant.util.dt import utcnow

        device_config: dict[str, Any] = {}
        store = self._hass.data.get(DOMAIN, {}).get("device_config_store")
        if store is not None:
            device_config = store.to_dict()

        await self._store.async_save(
            {
                "version": entry.version,
                "data": dict(entry.data),
                "options": dict(entry.options),
                "device_config": device_config,
                "backup_time": utcnow().isoformat(),
            }
        )
        _LOGGER.debug("Config backup saved")

    async def load(self) -> dict[str, Any] | None:
        """Load backup if it exists."""
        data = await self._store.async_load()
        if data and isinstance(data, dict) and "data" in data:
            return data
        return None


async def async_migrate_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Migrate config entry from older versions.

    v1 → v2: Initialize device_actions in options.
    v2 → v3: Initialize restore_config in options.
    v3 → v4: Initialize battery SOC limits in entry data.
    v4 → v5: Initialize battery optimization config in entry data.
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

    if config_entry.version < 4:
        new_data = {
            **config_entry.data,
            CONF_BATTERY_MAX_SOC: config_entry.data.get(
                CONF_BATTERY_MAX_SOC, DEFAULT_BATTERY_MAX_SOC
            ),
            CONF_BATTERY_MIN_SOC: config_entry.data.get(
                CONF_BATTERY_MIN_SOC, DEFAULT_BATTERY_MIN_SOC
            ),
        }
        hass.config_entries.async_update_entry(config_entry, data=new_data, version=4)
        _LOGGER.info("Migration to version 4 complete")

    if config_entry.version < 5:
        new_data = {
            **config_entry.data,
            CONF_BATTERY_OPTIMIZATION: config_entry.data.get(
                CONF_BATTERY_OPTIMIZATION, DEFAULT_BATTERY_OPTIMIZATION
            ),
        }
        hass.config_entries.async_update_entry(config_entry, data=new_data, version=5)
        _LOGGER.info("Migration to version 5 complete")

    if config_entry.version < 6:
        from .device_config_store import DeviceConfigStore

        store = DeviceConfigStore(hass)
        await store.async_load()
        legacy_actions = config_entry.options.get(CONF_DEVICE_ACTIONS)
        legacy_restore = config_entry.options.get(CONF_RESTORE_CONFIG)
        if not store.has_any_data and (legacy_actions or legacy_restore):
            await store.async_replace_all(
                device_actions=legacy_actions,
                restore_config=legacy_restore,
            )
            _LOGGER.info(
                "Migrated legacy device_actions/restore_config to DeviceConfigStore"
            )
        new_options = {
            k: v
            for k, v in config_entry.options.items()
            if k not in (CONF_DEVICE_ACTIONS, CONF_RESTORE_CONFIG)
        }
        hass.config_entries.async_update_entry(
            config_entry, options=new_options, version=6
        )
        _LOGGER.info("Migration to version 6 complete")

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

    # Pull optional restored payloads stashed in entry.data by the config flow
    # upload step. They are processed after the stores are loaded so legacy
    # device_actions/restore_config can be routed to the DeviceConfigStore.
    raw_restore_options = dict(entry.data).pop("_restore_options", None)
    raw_restore_device_config = dict(entry.data).pop("_restore_device_config", None)
    routed_device_actions: dict[str, Any] | None = None
    routed_restore_config: dict[str, Any] | None = None
    if raw_restore_options or raw_restore_device_config:
        new_data = {
            k: v
            for k, v in entry.data.items()
            if k not in ("_restore_options", "_restore_device_config")
        }
        # Strip legacy device_actions/restore_config out of restored options;
        # they are routed to the DeviceConfigStore below.
        filtered_options: dict[str, Any] = {}
        if raw_restore_options:
            for key, value in raw_restore_options.items():
                if key == CONF_DEVICE_ACTIONS:
                    routed_device_actions = value
                elif key == CONF_RESTORE_CONFIG:
                    routed_restore_config = value
                else:
                    filtered_options[key] = value
        hass.config_entries.async_update_entry(
            entry,
            data=new_data,
            options={**entry.options, **filtered_options},
        )
        _LOGGER.info("Applied restored options from backup")

    hass.data[DOMAIN][entry.entry_id] = {
        "config": entry.data,
    }

    # Ensure Battery Guard labels exist and store their actual HA IDs
    from .labels import async_ensure_labels

    label_map = await async_ensure_labels(hass)
    hass.data[DOMAIN]["label_map"] = label_map

    # Initialize state store for saving/restoring device states
    state_store = StateStore(hass)
    await state_store.async_load()
    hass.data[DOMAIN]["state_store"] = state_store

    # Initialize device config store (device_actions + restore_config)
    from .device_config_store import DeviceConfigStore

    device_config_store = DeviceConfigStore(hass)
    await device_config_store.async_load()
    hass.data[DOMAIN]["device_config_store"] = device_config_store

    # Apply routed backup payloads to the device config store
    if raw_restore_device_config:
        await device_config_store.async_replace_all(
            device_actions=raw_restore_device_config.get(
                CONF_DEVICE_ACTIONS
            ),
            restore_config=raw_restore_device_config.get(
                CONF_RESTORE_CONFIG
            ),
        )
    if routed_device_actions is not None or routed_restore_config is not None:
        await device_config_store.async_replace_all(
            device_actions=routed_device_actions,
            restore_config=routed_restore_config,
        )

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

    # Auto-backup config and make backup available for WebSocket API
    config_backup = ConfigBackup(hass)
    await config_backup.save(entry)
    hass.data[DOMAIN]["config_backup"] = config_backup

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
