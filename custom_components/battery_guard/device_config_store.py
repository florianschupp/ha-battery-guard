"""Device config store for Battery Guard.

Persists per-device business configuration (device_actions, restore_config)
in a dedicated HA Store, independent of `entry.options`. This keeps the data
immune to Options-Flow completions that overwrite `entry.options` with an
empty dict — a long-standing HA API behavior that previously caused silent
data loss for Battery Guard users.

Storage file: `.storage/battery_guard.device_config`
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_RESTORE_CONFIG

STORAGE_KEY = "battery_guard.device_config"
STORAGE_VERSION = 1

KEY_DEVICE_ACTIONS = "device_actions"
KEY_RESTORE_CONFIG = "restore_config"


class DeviceConfigStore:
    """Persist device_actions and restore_config in a dedicated HA Store."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store wrapper."""
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = {}

    async def async_load(self) -> None:
        """Load data from disk. Safe to call before any writes."""
        loaded = await self._store.async_load()
        if loaded and isinstance(loaded, dict):
            self._data = loaded

    @property
    def has_any_data(self) -> bool:
        """True if either object has been stored (non-empty)."""
        return bool(
            self._data.get(KEY_DEVICE_ACTIONS)
            or self._data.get(KEY_RESTORE_CONFIG)
        )

    def get_device_actions(self) -> dict[str, Any]:
        """Return the current device_actions map (empty dict if unset)."""
        return self._data.get(KEY_DEVICE_ACTIONS, {})

    def get_restore_config(self) -> dict[str, Any]:
        """Return the current restore_config (default if unset)."""
        return self._data.get(KEY_RESTORE_CONFIG, DEFAULT_RESTORE_CONFIG)

    async def async_set_device_actions(self, actions: dict[str, Any]) -> None:
        """Replace device_actions and persist."""
        self._data[KEY_DEVICE_ACTIONS] = actions
        await self._store.async_save(self._data)

    async def async_set_restore_config(self, config: dict[str, Any]) -> None:
        """Replace restore_config and persist."""
        self._data[KEY_RESTORE_CONFIG] = config
        await self._store.async_save(self._data)

    async def async_replace_all(
        self,
        device_actions: dict[str, Any] | None = None,
        restore_config: dict[str, Any] | None = None,
    ) -> None:
        """Replace one or both objects in a single save."""
        if device_actions is not None:
            self._data[KEY_DEVICE_ACTIONS] = device_actions
        if restore_config is not None:
            self._data[KEY_RESTORE_CONFIG] = restore_config
        await self._store.async_save(self._data)

    def to_dict(self) -> dict[str, Any]:
        """Return a shallow copy of the stored data for export/backup."""
        return dict(self._data)
