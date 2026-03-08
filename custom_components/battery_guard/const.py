"""Constants for the Battery Guard integration."""

from __future__ import annotations

from typing import Any

from homeassistant.const import Platform

DOMAIN = "battery_guard"
VERSION = "2.4.2"

# Platforms
PLATFORMS = [
    Platform.BINARY_SENSOR,
    Platform.SENSOR,
    Platform.NUMBER,
    Platform.SWITCH,
]

# Label IDs
LABEL_TIER1 = "battery_guard_tier1"
LABEL_TIER2 = "battery_guard_tier2"
LABEL_TIER3 = "battery_guard_tier3"
LABEL_IGNORE = "battery_guard_ignore"

ALL_LABELS = [LABEL_TIER1, LABEL_TIER2, LABEL_TIER3, LABEL_IGNORE]

# Label definitions (for automatic creation)
LABEL_DEFINITIONS = {
    LABEL_TIER1: {
        "name": "Battery Guard: Tier 1",
        "color": "red",
        "icon": "mdi:flash-off",
        "description": "Devices turned off immediately during power outage",
    },
    LABEL_TIER2: {
        "name": "Battery Guard: Tier 2",
        "color": "orange",
        "icon": "mdi:battery-alert-variant-outline",
        "description": "Devices turned off when battery drops below threshold",
    },
    LABEL_TIER3: {
        "name": "Battery Guard: Tier 3",
        "color": "green",
        "icon": "mdi:shield-check",
        "description": "Critical devices that are never turned off",
    },
    LABEL_IGNORE: {
        "name": "Battery Guard: Ignore",
        "color": "grey",
        "icon": "mdi:eye-off",
        "description": "Devices excluded from Battery Guard monitoring",
    },
}

# Entity domains tracked by Battery Guard
TRACKED_DOMAINS = ["switch", "input_boolean", "climate", "light", "media_player"]

# Default thresholds
DEFAULT_TIER2_THRESHOLD = 30
DEFAULT_TIER2_RECOVERY_THRESHOLD = 40
DEFAULT_CRITICAL_SOC = 10

# Config entry data keys
CONF_SOC_SENSOR = "soc_sensor"
CONF_GRID_SENSOR = "grid_sensor"
CONF_USE_VOLTAGE = "use_voltage"
CONF_VOLTAGE_PHASE_A = "voltage_phase_a"
CONF_VOLTAGE_PHASE_B = "voltage_phase_b"
CONF_VOLTAGE_PHASE_C = "voltage_phase_c"
CONF_TIER2_THRESHOLD = "tier2_threshold"
CONF_RECOVERY_THRESHOLD = "recovery_threshold"
CONF_CRITICAL_SOC = "critical_soc"
CONF_NOTIFY_SERVICES = "notify_services"
CONF_DEVICE_ACTIONS = "device_actions"
CONF_RESTORE_CONFIG = "restore_config"

# Restore defaults
DEFAULT_RESTORE_CONFIG: dict[str, Any] = {
    "restore_order": ["tier3", "tier2", "tier1"],
    "tier_delays": {
        "tier3": {"tier_delay": 0, "device_delay": 2},
        "tier2": {"tier_delay": 30, "device_delay": 5},
        "tier1": {"tier_delay": 60, "device_delay": 10},
    },
    "stay_off": [],
    "device_delays": {},
}

# Map tier keys to label constants
TIER_KEY_TO_LABEL: dict[str, str] = {
    "tier1": LABEL_TIER1,
    "tier2": LABEL_TIER2,
    "tier3": LABEL_TIER3,
}

# Valid actions per entity domain
DOMAIN_ACTIONS: dict[str, list[str]] = {
    "switch": ["turn_off", "turn_on"],
    "input_boolean": ["turn_off", "turn_on"],
    "climate": ["set_hvac_mode", "set_temperature", "turn_off"],
    "light": ["dim", "turn_off"],
    "media_player": ["turn_off"],
}
