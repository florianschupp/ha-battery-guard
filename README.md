# Battery Guard for Home Assistant

> **Note:** Built and tested with Huawei SUN2000 + LUNA2000 + BackupBox. Should work with any PV battery system that exposes SOC and grid status sensors in Home Assistant. Also suitable for off-grid (island) setups. Use at your own risk and feel free to adapt it to your needs.

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/florianschupp/ha-battery-guard)](https://github.com/florianschupp/ha-battery-guard/releases)
[![License: MIT](https://img.shields.io/github/license/florianschupp/ha-battery-guard)](LICENSE)

**Smart appliance management based on battery capacity.**

Battery Guard monitors your PV battery system and automatically manages non-essential appliances in priority tiers when a power outage is detected — or when running off-grid — preserving battery power for critical loads.

---

## Features

| | Feature | Description |
|---|---------|-------------|
| ⚡ | **3-tier priority system** | Assign appliances to tiers based on importance |
| 🎛️ | **Graduated emergency actions** | Per-appliance, per-tier actions: set HVAC mode, dim lights, set temperature, or turn off |
| 🔌 | **Automatic outage detection** | Via grid status sensor or voltage monitoring (Shelly 3EM) |
| 🔋 | **SOC-based tier management** | Tier 2 actions execute when battery drops below threshold |
| 💾 | **State save & restore** | Appliance states are captured before action and fully restored when grid returns |
| 📈 | **Hysteresis control** | Separate shutdown and recovery thresholds prevent oscillation |
| 🔔 | **Flexible notifications** | Push notifications + persistent HA notifications |
| 🧙 | **Built-in setup wizard** | Sidebar panel with inline tier buttons and domain-aware action config |

---

## How It Works

```
Power Outage ──► Tier 1 actions execute (HVAC → fan mode, EV charger off)
                     │
Battery < 30% ──► Tier 2 actions execute (lights dim, appliances off)
                     │
Battery > 40% ──► Tier 2 devices restored
                     │
Grid Restored ──► All devices restored to pre-outage state
```

**Tier 3** appliances (router, security cameras, freezer) are never turned off — they are protected.

Appliances can be in **multiple tiers** with different actions. Example: an air conditioner switches to fan-only mode in Tier 1 and turns off completely in Tier 2.

---

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

---

## Configuration

### Initial Setup

The config flow guides you through:

| Step | What | Required? |
|------|------|-----------|
| 1 | **Battery SOC Sensor** — your battery state-of-charge sensor | Optional* |
| 2 | **Grid Connection** — grid status sensor or voltage monitoring | Optional* |
| 3 | **Thresholds** — Tier 2 shutdown (30%), recovery (40%), critical (10%) | Yes |
| 4 | **Notifications** — select notification services for alerts | Yes |

> \* Sensors are optional during setup. Install Battery Guard first, add sensors later via **Configure** once your PV system is integrated.

### Device Assignment

Open **Battery Guard** in the sidebar to assign appliances using the built-in wizard:

- Click **T1**, **T2**, **T3**, or **—** (Ignore) per device
- Climate and light appliances can be in both T1 and T2 with different actions
- Use the inline dropdowns to configure HVAC mode, temperature, or brightness

See the full [User Guide](docs/USER_GUIDE.md) for detailed instructions.

### Changing Settings

Go to **Settings → Devices & Services → Battery Guard → Configure** to change sensors, thresholds, or notifications at any time. The integration reloads automatically.

---

## Supported Hardware

Battery Guard works with any PV battery system that exposes sensors in Home Assistant:

- A **state-of-charge (SOC)** sensor (e.g., via Modbus)
- A **grid connection status** sensor, or **per-phase voltage sensors** (e.g., Shelly 3EM)

Tested with: **Huawei SUN2000** inverter + **LUNA2000** battery + **BackupBox**

---

## Reference

### Entities

| Entity | Type | Description |
|:-------|:-----|:------------|
| Power Outage | `binary_sensor` | Detects grid power loss |
| Unassigned Appliances | `sensor` | Counts appliances not assigned to any tier |
| Tier 2 Shutdown Threshold | `number` | SOC level that triggers Tier 2 actions |
| Tier 2 Recovery Threshold | `number` | SOC level that restores Tier 2 devices |
| Battery Guard Active | `switch` | Emergency mode on/off |
| Auto Recovery | `switch` | Automatic Tier 2 recovery on/off |
| Tier 2 Disabled | `switch` | Tracks whether Tier 2 has been executed |

### Services

| Service | Description |
|:--------|:------------|
| `battery_guard.tier_off` | Execute configured actions for all appliances in a tier |
| `battery_guard.tier_on` | Restore appliances in a tier to their saved state |
| `battery_guard.restore_all` | Restore all appliances and reset emergency mode |
| `battery_guard.notify` | Send notification via configured services |

### Supported Actions per Domain

| Domain | Available Actions |
|:-------|:------------------|
| `switch` | Turn off |
| `climate` | Set HVAC mode, set temperature, turn off |
| `light` | Dim (configurable %), turn off |
| `media_player` | Turn off |

---

## License

MIT License — see [LICENSE](LICENSE) for details.
