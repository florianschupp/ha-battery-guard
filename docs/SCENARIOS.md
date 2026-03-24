# Battery Guard — Scenario Reference

This document describes all scenarios Battery Guard handles (and its known limitations).
Target audience: end users and developers.

## System Overview

```
[NORMAL]  ──outage (5s debounce)──▶  [EMERGENCY]  ──grid restored (30s debounce)──▶  [NORMAL]
                                         │
                                    SOC monitoring
                                    ├─ SOC < Tier 2 threshold  →  Tier 2 OFF
                                    ├─ SOC > Recovery threshold →  Tier 2 ON (if auto-recovery)
                                    └─ SOC < Critical SOC       →  Critical alert + T3 state save
```

## Handled Scenarios

### S1: Normal Power Outage

| Phase | What happens |
|-------|-------------|
| Grid drops | Battery Guard detects via grid sensor or voltage monitoring |
| 5 second debounce | No action yet — prevents false triggers on grid flicker |
| Debounce expires | Emergency mode ON, Tier 1 device states saved, Tier 1 actions executed |
| Battery optimization | If enabled: charge limit raised (e.g., 90%→100%), discharge limit lowered (e.g., 20%→10%) |
| Notification | Critical push: "Tier 1: ✅ 6 devices (4× off, 1× HVAC → fan_only, 1× dim → 25%)\nBattery: 90%" |

**Devices affected:** All Tier 1 devices (high-consumption: EV charger, dryer, oven, etc.)

---

### S2: Grid Flicker (< 5 seconds)

| Phase | What happens |
|-------|-------------|
| Grid drops | Outage debounce starts (5s) |
| Grid returns within 5s | Debounce cancelled |
| Result | No action, no notification — "Grid flicker detected" logged |

**Why this matters:** Prevents unnecessary device shutdowns during brief voltage dips.

---

### S3: Battery Drains Below Tier 2 Threshold

| Phase | What happens |
|-------|-------------|
| Emergency mode active | Tier 1 already OFF, Tier 2 + 3 still running |
| SOC drops below threshold | Tier 2 device states saved, Tier 2 actions executed |
| Notification | "Tier 2 devices shut down. SOC: X%" |

**Default threshold:** 30% (configurable 10-90%)

---

### S4: Battery Recovers (Solar Charging During Outage)

| Phase | What happens |
|-------|-------------|
| Tier 2 disabled, SOC rising | Solar panels charge battery during daytime |
| SOC rises above recovery threshold | Tier 2 devices restored to saved state |
| Notification | "Tier 2 devices restored. SOC: X%" |

**Condition:** Auto-Recovery must be enabled (default: ON).
**Default recovery threshold:** 40% (must be higher than Tier 2 threshold)

---

### S5: Critical Battery Level

| Phase | What happens |
|-------|-------------|
| SOC drops below critical | Tier 3 device states saved preemptively |
| Notification | Critical push: "Battery critical! Only Tier 3 devices active. Minimize usage!" |
| Tier 3 devices | Still running — critical infrastructure (router, NAS, fridge) |

**Default critical SOC:** 10% (configurable 5-30%)
**Purpose:** Preemptive state save ensures Tier 3 devices can be properly restored even if HA crashes due to power loss.

---

### S6: Grid Power Restored

| Phase | What happens |
|-------|-------------|
| Grid returns | Restore debounce starts (30s) |
| 30 seconds stable | Staged restore begins |
| Tier 3 restored | Immediately (delay: 0s, device gap: 2s) |
| Tier 2 restored | After 30s tier delay (device gap: 5s) |
| Tier 1 restored | After 60s tier delay (device gap: 10s) |
| Battery optimization | If enabled: daily values restored (e.g., 100%→90% charge, 10%→20% discharge) |
| Cleanup | Emergency mode OFF, saved states cleared |
| Notification | "✅ Grid Power Restored\n✅ 9 devices\nBattery: 45%\nOutage duration: 2h 15min" |

**Why staged?** Prevents power spike from all devices turning on simultaneously.
**Stay-off list:** Devices configured as "stay off" are never restored.

---

### S7: Grid Flapping During Restore

| Phase | What happens |
|-------|-------------|
| Grid returns, restore debounce running | 30s countdown active |
| Grid drops again during debounce | Debounce cancelled, outage debounce starts |
| Grid returns again | New restore debounce starts from 0 |
| Result | Restore only happens after 30s of stable grid |

---

### S8: New Outage During Active Restore

| Phase | What happens |
|-------|-------------|
| Restore in progress | Tier 3 restored, Tier 2 partially restored |
| Grid drops again | New outage detected, 5s debounce |
| Debounce expires | Tier 1 OFF executed again |
| State protection | FirstSaveWins: original pre-outage states NOT overwritten |
| Next restore | Will use the original states from the first outage |

---

### S9: Device Fails to Respond

| Phase | What happens |
|-------|-------------|
| Tier action executed | Service call to device |
| Device unreachable | Retry 1 after 2s |
| Still unreachable | Retry 2 after 4s |
| Still unreachable | Retry 3 after 8s |
| All retries failed | Device skipped, counted as failure |
| Notification | Includes failure count: "Tier 1 OFF (5/6 successful)" |

---

### S10: Home Assistant Restart During Outage

| Phase | What happens |
|-------|-------------|
| HA crashes or restarts | Integration reloads |
| State recovery | Saved device states loaded from disk (`.storage/battery_guard.state_store`) |
| Emergency mode | `active` switch state persists |
| SOC monitoring | Resumes automatically |
| Result | Outage handling continues seamlessly |

---

### S11: Battery Already Low When Outage Starts

| Phase | What happens |
|-------|-------------|
| SOC at 25%, grid drops | Outage debounce (5s) |
| Debounce expires | Tier 1 OFF executed |
| Next SOC update | SOC still below Tier 2 threshold (30%) |
| Result | Tier 2 OFF triggered on next SOC state change |

**Note:** Tier 2 does not fire instantly — it requires a SOC sensor state change event.

---

### S12: Unassigned Devices Detected

| Phase | What happens |
|-------|-------------|
| Coordinator runs (every 5 min) | Scans for new devices without tier labels |
| New unassigned count > previous | Notification sent |
| Notification | "X devices without label — open Battery Guard panel to assign" |

---

## Known Limitations

### L1: Partial Phase Loss (2 of 3 Phases Down)

| Issue | Only detects outage when ALL 3 voltage phases drop below 50V |
|-------|-------------|
| Impact | Single-phase or two-phase outages are not detected via voltage monitoring |
| Workaround | Use the grid sensor (Huawei inverter status) as primary detection — it detects all outage types |
| Design reason | Prevents false positives from single-phase measurement errors |

---

### L2: Complete Battery Death (0% SOC)

| Issue | No automatic Tier 3 shutdown before battery runs out |
|-------|-------------|
| Impact | Tier 3 devices (router, NAS, fridge) lose power uncontrolled |
| What IS handled | Critical SOC alert at 10%, preemptive Tier 3 state save |
| What is NOT handled | Graceful Tier 3 shutdown before HA itself loses power |
| Potential fix | Add configurable "emergency shutdown" threshold (e.g., 3%) that executes Tier 3 OFF |

---

### L3: SOC Oscillation Near Recovery Threshold

| Issue | No hysteresis on SOC recovery — can oscillate |
|-------|-------------|
| Example | SOC rises to 41% → Tier 2 restored → devices draw power → SOC drops to 39% → Tier 2 OFF again |
| Impact | Devices may cycle on/off repeatedly |
| Potential fix | Add cooldown timer (e.g., 10 min) after Tier 2 recovery before allowing re-trigger |

---

### L4: Service Call Timeout

| Issue | No timeout on individual HA service calls |
|-------|-------------|
| Impact | If a device service call never returns, the entire tier operation blocks |
| Example | A smart plug with broken firmware that accepts but never completes the call |
| Potential fix | Add `asyncio.wait_for()` with configurable timeout per service call |

---

### L5: Failed Devices Not Re-Attempted

| Issue | After 3 failed retries, device is dropped — no later retry round |
|-------|-------------|
| Impact | A device that was temporarily offline (e.g., WiFi reconnecting) won't be retried |
| Potential fix | Queue failed devices for periodic retry (e.g., every 5 min while emergency mode active) |

---

### L6: Grid Sensor State Matching

| Issue | Grid sensor state matching is case-sensitive and limited |
|-------|-------------|
| Accepted OFF states | `off-grid`, `disconnected`, `off_grid`, `off` |
| Not matched | `Off-Grid`, `OFF-GRID`, `offline`, `unavailable` |
| Impact | Non-standard grid sensor values may not trigger outage detection |
| Potential fix | Normalize to lowercase before matching, expand accepted states |

---

### L7: No Emergency Mode Timeout

| Issue | System stays in emergency mode indefinitely if grid never returns |
|-------|-------------|
| Impact | If the outage lasts days and battery slowly dies, no graceful degradation |
| What IS handled | Critical SOC alert at 10% with preemptive state save |
| Potential fix | Configurable max emergency duration with automated Tier 3 graceful shutdown |

---

## Scenario Flow Diagram

```
                         ┌─────────────────────┐
                         │      NORMAL          │
                         │   (active = OFF)     │
                         └──────────┬───────────┘
                                    │ Grid drops
                                    ▼
                         ┌─────────────────────┐
                         │  OUTAGE DEBOUNCE     │
                         │     (5 seconds)      │
                         └──────┬───────┬───────┘
                    Grid returns│       │ Timer expires
                                ▼       ▼
                         ┌──────┐ ┌─────────────────────┐
                         │CANCEL│ │    EMERGENCY         │
                         │(S2)  │ │ active=ON, T1 OFF    │
                         └──────┘ └──────┬──────┬────────┘
                                         │      │
                         SOC < T2 threshold      SOC < critical
                                │                │
                                ▼                ▼
                    ┌───────────────┐  ┌─────────────────┐
                    │  TIER 2 DOWN  │  │  CRITICAL ALERT  │
                    │ tier2_dis=ON  │  │ T3 states saved  │
                    │ T2 OFF        │  │                   │
                    └───────┬───────┘  └──────────────────┘
                            │
            SOC > recovery  │
            (auto_recovery) │
                            ▼
                    ┌───────────────┐
                    │ TIER 2 RECOV  │
                    │ tier2_dis=OFF │
                    │ T2 ON         │
                    └───────────────┘

    ─── At any point during EMERGENCY ───

                         Grid returns
                              │
                              ▼
                    ┌─────────────────────┐
                    │  RESTORE DEBOUNCE   │
                    │    (30 seconds)     │
                    └──────┬───────┬──────┘
               Grid drops  │       │ Timer expires
                           ▼       ▼
                    ┌──────┐ ┌─────────────────┐
                    │CANCEL│ │  STAGED RESTORE  │
                    │(S7)  │ │ T3 → T2 → T1    │
                    └──────┘ └────────┬─────────┘
                                      │
                                      ▼
                              ┌──────────────┐
                              │   NORMAL     │
                              │ active=OFF   │
                              └──────────────┘
```

## Huawei Solar Sensor Reference

For Huawei SUN2000 + LUNA2000 + BackupBox setups using the [Huawei Solar](https://github.com/wlcrs/huawei_solar) integration:

| Setting | Entity ID | Device | Values |
|---------|-----------|--------|--------|
| SOC Sensor | `sensor.batteries_state_of_capacity` | Batterien | 0-100 % |
| Grid Sensor | `sensor.wechselrichter_netzunabhangigkeitsstatus` | Wechselrichter | On-grid / Off-grid |

**Alternative grid sensor:** `sensor.wechselrichter_geratestatus` (same On-grid/Off-grid values)

**Voltage monitoring (optional):** Not needed with Huawei Solar — the grid sensor is reliable. Use Shelly 3EM voltage monitoring only as a secondary safeguard.
