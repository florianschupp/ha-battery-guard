"""Constants for the Battery Guard integration."""

from __future__ import annotations

from typing import Any

from homeassistant.const import Platform

DOMAIN = "battery_guard"
VERSION = "2.26.0-rc.1"

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

# Debounce timers (seconds)
OUTAGE_DEBOUNCE_SECONDS = 5
RESTORE_DEBOUNCE_SECONDS = 30

# Phase voltage below this counts as "no mains" on that phase. Lives here so the
# detection (binary_sensor) and the restore gate (automation_engine via
# grid_status) share ONE definition (#70).
VOLTAGE_OUTAGE_THRESHOLD = 50.0

# #70 restore gate — after (re)start, the raw grid source is ignored for this long.
# Same reason as HEALTH_STARTUP_GRACE_SECONDS: the Huawei/Modbus integration needs
# up to ~2 min to reconnect and may serve a stale value in between. Acting on that
# value would restore every shed load onto the island battery. Deliberately NOT
# EVENT_HOMEASSISTANT_STARTED — that fires within seconds of setup, long before
# Modbus is back.
RESTORE_STARTUP_GRACE_SECONDS = 180
# Hard floor between two "restore suspended" notices, even when the cause changed.
# Bounds the alert channel that also carries the critical-SOC alarm.
RESTORE_SUSPENDED_RENOTIFY_SECONDS = 900  # 15 min

# Sensor health watchdog (seconds)
HEALTH_DEBOUNCE_SECONDS = 60
# Startup grace raised 60 → 180: the Huawei/Modbus integration can take ~2 min to
# (re)connect after an HA restart; a shorter grace produced false "unavailable →
# available again" pairs on every restart (#56).
HEALTH_STARTUP_GRACE_SECONDS = 180
# Periodic sweep cadence: the watchdog is actively polling (not only event-driven),
# because a frozen sensor fires no state-change events (#56).
HEALTH_SWEEP_SECONDS = 30
# Freshness: a source that is "available" but has reported no new value for longer than
# this is treated as frozen/stale. Starting value; refine from real data.
HEALTH_STALE_SECONDS = 900  # 15 min (X)
# Flap detection: >= HEALTH_FLAP_THRESHOLD unavailable transitions within
# HEALTH_FLAP_WINDOW_SECONDS raises one "connection unstable" alert.
HEALTH_FLAP_WINDOW_SECONDS = 600  # 10 min (W)
HEALTH_FLAP_THRESHOLD = 3  # N

# hass.data key for the published sensor-health snapshot
DATA_SENSOR_HEALTH = "sensor_health"

# Retry settings
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds, exponential backoff: 2s, 4s, 8s

# Default thresholds
DEFAULT_TIER2_THRESHOLD = 30
DEFAULT_TIER2_RECOVERY_THRESHOLD = 40
DEFAULT_CRITICAL_SOC = 10

# Battery system SOC limits (informational, not all systems expose these)
DEFAULT_BATTERY_MAX_SOC = 100
DEFAULT_BATTERY_MIN_SOC = 0

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
CONF_BATTERY_MAX_SOC = "battery_max_soc"
CONF_BATTERY_MIN_SOC = "battery_min_soc"
CONF_DEVICE_ACTIONS = "device_actions"
CONF_RESTORE_CONFIG = "restore_config"
CONF_BATTERY_OPTIMIZATION = "battery_optimization"
CONF_BATTERY_CHARGE_ENTITY = "battery_charge_entity"
CONF_BATTERY_DISCHARGE_ENTITY = "battery_discharge_entity"

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

# Battery optimization defaults
DEFAULT_BATTERY_OPTIMIZATION: dict[str, Any] = {
    "enabled": False,
    "entities": [],
    # Entity structure: {"entity_id": "number.x", "normal_value": 90, "outage_value": 100}
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
