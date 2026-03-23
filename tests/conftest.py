"""Shared fixtures for Battery Guard tests.

Mocks the homeassistant package so tests can run without a full HA installation.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =========================================================================
# Mock homeassistant package before any Battery Guard imports
# =========================================================================

import types

# Create proper module hierarchy for homeassistant
_ha = types.ModuleType("homeassistant")
_ha_const = types.ModuleType("homeassistant.const")
_ha_const.STATE_OFF = "off"
_ha_const.STATE_ON = "on"
_ha_const.STATE_UNAVAILABLE = "unavailable"
_ha_const.STATE_UNKNOWN = "unknown"

# Platform enum mock
_platform = MagicMock()
_platform.BINARY_SENSOR = "binary_sensor"
_platform.SENSOR = "sensor"
_platform.NUMBER = "number"
_platform.SWITCH = "switch"
_ha_const.Platform = _platform

_ha.const = _ha_const

# Core mocks
_ha_core = MagicMock()
_ha_core.CALLBACK_TYPE = None
_ha_core.callback = lambda f: f  # decorator passthrough
_ha.core = _ha_core

# Config entries
_ha_config_entries = MagicMock()
_ha.config_entries = _ha_config_entries

# Helpers
_ha_helpers = types.ModuleType("homeassistant.helpers")
_ha_helpers_er = MagicMock()
_ha_helpers.entity_registry = _ha_helpers_er

_ha_helpers_storage = types.ModuleType("homeassistant.helpers.storage")
_ha_helpers_storage.Store = MagicMock
_ha_helpers.storage = _ha_helpers_storage

_ha_helpers_event = MagicMock()
_ha_helpers.event = _ha_helpers_event

_ha_helpers_selector = MagicMock()
_ha_helpers.selector = _ha_helpers_selector

_ha.helpers = _ha_helpers

# Components
_ha_components = MagicMock()
_ha.components = _ha_components

# Register all modules
sys.modules["homeassistant"] = _ha
sys.modules["homeassistant.const"] = _ha_const
sys.modules["homeassistant.core"] = _ha_core
sys.modules["homeassistant.config_entries"] = _ha_config_entries
sys.modules["homeassistant.components"] = _ha_components
sys.modules["homeassistant.components.websocket_api"] = MagicMock()
sys.modules["homeassistant.helpers"] = _ha_helpers
sys.modules["homeassistant.helpers.entity_registry"] = _ha_helpers_er
sys.modules["homeassistant.helpers.event"] = _ha_helpers_event
sys.modules["homeassistant.helpers.storage"] = _ha_helpers_storage
sys.modules["homeassistant.helpers.selector"] = _ha_helpers_selector
sys.modules["homeassistant.helpers.label_registry"] = MagicMock()
sys.modules["voluptuous"] = MagicMock()

# Now safe to import Battery Guard modules
from custom_components.battery_guard.const import (  # noqa: E402
    CONF_BATTERY_OPTIMIZATION,
    CONF_CRITICAL_SOC,
    CONF_DEVICE_ACTIONS,
    CONF_RESTORE_CONFIG,
    CONF_SOC_SENSOR,
    DEFAULT_BATTERY_OPTIMIZATION,
    DEFAULT_RESTORE_CONFIG,
    DOMAIN,
)


class MockState:
    """Minimal HA State object."""

    def __init__(self, state: str, attributes: dict[str, Any] | None = None):
        self.state = state
        self.attributes = attributes or {}


class MockEntityEntry:
    """Minimal HA entity registry entry."""

    def __init__(
        self,
        entity_id: str,
        platform: str = DOMAIN,
        unique_id: str = "",
        labels: set[str] | None = None,
        disabled_by: str | None = None,
    ):
        self.entity_id = entity_id
        self.platform = platform
        self.unique_id = unique_id
        self.labels = labels or set()
        self.disabled_by = disabled_by


@pytest.fixture
def mock_hass():
    """Create a minimal HA mock with states, services, and data."""
    hass = MagicMock()
    hass.states = MagicMock()
    hass.services = MagicMock()
    hass.services.async_call = AsyncMock()
    hass.data = {DOMAIN: {}}
    hass.async_create_task = MagicMock(side_effect=lambda coro: coro)

    # Default: no states
    hass.states.get = MagicMock(return_value=None)

    return hass


@pytest.fixture
def mock_entry():
    """Create a mock config entry."""
    entry = MagicMock()
    entry.entry_id = "test_entry_id"
    entry.data = {
        CONF_SOC_SENSOR: "sensor.battery_soc",
        CONF_CRITICAL_SOC: 10,
        CONF_BATTERY_OPTIMIZATION: DEFAULT_BATTERY_OPTIMIZATION,
    }
    entry.options = {
        CONF_DEVICE_ACTIONS: {},
        CONF_RESTORE_CONFIG: DEFAULT_RESTORE_CONFIG,
    }
    return entry


@pytest.fixture
def state_store(mock_hass):
    """Create a StateStore with mocked hass (no disk persistence)."""
    with patch(
        "custom_components.battery_guard.state_store.Store"
    ) as mock_store_cls:
        mock_store_instance = MagicMock()
        mock_store_instance.async_load = AsyncMock(return_value=None)
        mock_store_instance.async_save = AsyncMock()
        mock_store_cls.return_value = mock_store_instance

        from custom_components.battery_guard.state_store import StateStore

        store = StateStore(mock_hass)
        return store


def make_state(state: str, attributes: dict[str, Any] | None = None) -> MockState:
    """Helper to create a MockState."""
    return MockState(state, attributes or {})
