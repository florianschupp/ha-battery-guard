# Battery Guard for Home Assistant

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/florianschupp/ha-battery-guard)](https://github.com/florianschupp/ha-battery-guard/releases)
[![License: MIT](https://img.shields.io/github/license/florianschupp/ha-battery-guard)](LICENSE)

**Automatic device management during power outages for PV battery systems.**

Battery Guard monitors your PV battery system and automatically shuts down non-essential devices in tiers when a power outage is detected, preserving battery power for critical loads.

## Features

- **3-tier device priority system** — Assign devices to tiers based on importance
- **Automatic power outage detection** — Via grid status sensor or voltage monitoring (Shelly 3EM)
- **SOC-based tier management** — Tier 2 devices turn off when battery drops below threshold
- **Hysteresis control** — Separate shutdown and recovery thresholds prevent oscillation
- **Automatic restoration** — All devices restored when grid power returns
- **Critical battery alerts** — Notifications when battery reaches critical levels
- **Built-in device wizard** — Sidebar panel for easy device-to-tier assignment
- **Flexible notifications** — Persistent notifications + configurable notification services

## How It Works

When a power outage is detected:

1. **Immediately**: Tier 1 devices are turned off (HVAC, water heaters, EV charger)
2. **Battery below threshold** (default 30%): Tier 2 devices are turned off (refrigerators, lights)
3. **Battery recovers** (default 40%): Tier 2 devices are restored
4. **Grid restored**: All devices are restored automatically

**Tier 3** devices (internet router, security cameras) are never turned off.

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click the three dots menu (top right) → **Custom repositories**
3. Add `florianschupp/ha-battery-guard` with category **Integration**
4. Search for "Battery Guard" and click **Download**
5. Restart Home Assistant
6. Go to **Settings → Devices & Services → Add Integration → Battery Guard**

### Manual

1. Copy the `custom_components/battery_guard` folder to your `config/custom_components/` directory
2. Restart Home Assistant
3. Add the integration via **Settings → Devices & Services**

## Configuration

### Initial Setup

The config flow guides you through 4 steps:

1. **Battery SOC Sensor** — Select your battery state-of-charge sensor *(optional — add later if Modbus is not set up yet)*
2. **Grid Connection** — Choose grid status sensor or voltage monitoring *(optional)*
3. **Thresholds** — Set tier 2 shutdown (default 30%), recovery (default 40%), and critical (default 10%) levels
4. **Notifications** — Select notification services for alerts

> **Note:** All sensors are optional during setup. You can install Battery Guard first and add sensors later via the integration options once your PV system is fully integrated.

### Device Assignment

After installation, open **Battery Guard** in the sidebar to assign devices to tiers using the built-in wizard.

### Changing Settings Later

Go to **Settings → Devices & Services → Battery Guard → Configure** to change sensors, thresholds, or notification services at any time. The integration reloads automatically.

## Supported Hardware

Battery Guard works with any PV battery system that exposes:
- A **state-of-charge (SOC)** sensor (e.g., via Modbus)
- A **grid connection status** sensor, or **per-phase voltage sensors** (e.g., Shelly 3EM)

Tested with:
- Huawei SUN2000 inverter + LUNA2000 battery + BackupBox

## Entities Created

| Entity | Type | Description |
|--------|------|-------------|
| Power Outage | Binary Sensor | Detects grid power loss |
| Unassigned Devices | Sensor | Counts devices not assigned to any tier |
| Tier 2 Shutdown Threshold | Number | SOC level to turn off tier 2 devices |
| Tier 2 Recovery Threshold | Number | SOC level to restore tier 2 devices |
| Battery Guard Active | Switch | Emergency mode status |
| Auto Recovery | Switch | Enable automatic tier 2 recovery |
| Tier 2 Disabled | Switch | Tracks whether tier 2 is currently shut down |

## Services

| Service | Description |
|---------|-------------|
| `battery_guard.tier_off` | Turn off all devices in a tier |
| `battery_guard.tier_on` | Restore devices in a tier |
| `battery_guard.restore_all` | Restore all devices and reset status |
| `battery_guard.notify` | Send notification via configured services |

## License

MIT License — see [LICENSE](LICENSE) for details.
