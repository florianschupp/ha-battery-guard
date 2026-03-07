"""Constants for the Battery Guard integration."""

from homeassistant.const import Platform

DOMAIN = "battery_guard"
VERSION = "2.0.2"

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
TRACKED_DOMAINS = ["switch", "climate", "light", "media_player"]

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

# Valid actions per entity domain
DOMAIN_ACTIONS: dict[str, list[str]] = {
    "switch": ["turn_off"],
    "climate": ["set_hvac_mode", "set_temperature", "turn_off"],
    "light": ["dim", "turn_off"],
    "media_player": ["turn_off"],
}
