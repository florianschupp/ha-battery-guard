# Battery Guard — User Guide

## Overview

Battery Guard is a Home Assistant integration that automatically manages your devices during power outages. It uses your Huawei SUN2000 inverter, LUNA2000 battery, and BackupBox to provide graduated emergency power management in three priority tiers.

## How It Works

When a power outage is detected:

1. **Tier 1** actions execute immediately — high-consumption devices are turned off or adjusted
2. **Tier 2** actions execute when the battery drops below a configurable threshold — moderate devices are turned off
3. **Tier 3** devices are never turned off — critical infrastructure stays on as long as battery lasts

When grid power is restored, all devices are automatically restored to their previous state.

## Setup

### 1. Install via HACS

1. Open HACS in Home Assistant
2. Add the Battery Guard repository as a custom repository
3. Install Battery Guard
4. Restart Home Assistant

### 2. Configure Integration

1. Go to **Settings → Devices & Services → Add Integration → Battery Guard**
2. Set SOC thresholds:
   - **Tier 2 threshold** (default: 30%) — when battery drops below this, Tier 2 actions execute
   - **Recovery threshold** (default: 40%) — when battery recovers above this, Tier 2 devices are restored
   - **Critical SOC** (default: 10%) — sends a critical alert at this level
3. Select notification services (e.g., mobile app notifications)

### 3. Configure Sensors (Options Flow)

After setup, configure your actual sensors:

1. Go to **Settings → Devices & Services → Battery Guard → Configure**
2. Select your **SOC sensor** (battery state of charge, e.g., from Huawei Modbus)
3. Select your **Grid sensor** (power outage detection, binary sensor)
4. Optionally enable voltage monitoring with Shelly 3EM phase sensors

### 4. Assign Devices (Wizard)

Open the Battery Guard panel from the sidebar to assign devices:

1. The wizard discovers all switchable devices (switches, climate, lights, media players)
2. For each device, click the tier buttons to assign:
   - **T1** — Action on power outage
   - **T2** — Action on low battery
   - **T3** — Always on (never turned off)
   - **—** (Ignore) — Excluded from Battery Guard
3. Climate and light devices can be in **both T1 and T2** with different actions
4. Click **Continue** and then **Apply Labels & Actions** to save

## Graduated Emergency Actions

### What are graduated actions?

Instead of simply turning everything off, Battery Guard supports domain-specific actions:

| Domain | Available Actions |
|--------|-------------------|
| **switch** | Turn off |
| **climate** | Set HVAC mode (e.g., fan only), Set temperature, Turn off |
| **light** | Dim (set brightness %), Turn off |
| **media_player** | Turn off |

### Example: Climate Device

A climate device (air conditioner) can be configured like this:

- **Tier 1** (power outage): Set HVAC mode to "Fan only" — stops heating/cooling but keeps air circulation
- **Tier 2** (low battery): Turn off completely

This means:
1. When power goes out → AC switches to fan-only mode (low power consumption)
2. When battery drops below 30% → AC turns off completely
3. When grid returns → AC is restored to its original state (e.g., cooling at 22°C)

### State Save & Restore

Battery Guard automatically saves each device's state before taking any action. When grid power is restored:

- Climate devices are restored to their original HVAC mode, temperature, and fan settings
- Lights are restored to their original brightness and color
- Switches are turned back on

The first save wins: if a device is in both T1 and T2, the state saved during T1 is preserved.

## Entities Created

Battery Guard creates several entities for monitoring and control:

| Entity | Type | Description |
|--------|------|-------------|
| Battery Guard Active | Switch | Shows/controls whether emergency mode is active |
| Tier 2 Disabled | Switch | Shows if Tier 2 has been executed |
| Auto-Recovery Tier 2 | Switch | Enable/disable automatic Tier 2 recovery |
| Tier 2 SOC Threshold | Number | Adjustable SOC threshold for Tier 2 |
| Tier 2 Recovery Threshold | Number | SOC level at which Tier 2 devices are restored |
| Unassigned Devices | Sensor | Count of devices not yet assigned to a tier |

## Testing

To test Battery Guard without an actual power outage:

1. Go to **Developer Tools → States**
2. Find your grid/power outage sensor
3. Toggle it to simulate a power outage
4. Observe Tier 1 actions executing
5. Lower the SOC sensor value below the Tier 2 threshold
6. Observe Tier 2 actions executing
7. Toggle the grid sensor back to normal
8. Observe all devices being restored

## Notifications

Battery Guard sends notifications at key events:

- ⚡ **Power outage detected** — Tier 1 actions executed
- 🔋 **Low battery** — Tier 2 actions executed
- 🔋 **Battery recovered** — Tier 2 devices restored
- ✅ **Grid power restored** — All devices restored
- 🚨 **Critical battery** — Below critical SOC level
- 🔌 **New unassigned devices** — New devices detected that need assignment

## Troubleshooting

### Devices not turning off during outage
- Check that the device is assigned to Tier 1 or Tier 2 in the wizard
- Verify the power outage sensor is working correctly
- Check Home Assistant logs for errors

### Devices not restoring after grid return
- Check that the "Battery Guard Active" switch was on during the outage
- Verify the grid sensor returned to normal state
- Check logs for restoration errors

### Wizard shows "Connecting..." forever
- The wizard auto-connects when opened as a sidebar panel
- If it stays loading, try refreshing the page
- Check browser console for WebSocket errors
