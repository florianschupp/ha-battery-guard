# HA Battery Guard -- Product Requirements Document

**Version:** 1.0
**Date:** 2026-03-06
**Author:** Florian Schupp

---

## 1. Problem Statement

Houses with PV systems and battery backup face a critical problem during power outages: the battery drains rapidly when all connected devices continue operating. A 10 kWh battery can be depleted in under an hour if high-consumption devices like HVAC systems, water heaters, and EV chargers remain active.

Manual device management during outages is impractical. Occupants may not be home, may not know which devices to turn off first, or may lack the technical knowledge to interact with Home Assistant. Non-technical household members need a solution that works automatically and can be configured without YAML editing.

## 2. Solution

**HA Battery Guard** is a two-part system:

1. **YAML Automation Packages** -- A label-based, 3-tier automation that runs natively in Home Assistant. It monitors grid status and battery SOC, then progressively shuts down devices based on priority tiers to maximize battery life during outages.

2. **Setup Wizard** -- A React-based web application that provides an end-user-friendly interface for discovering devices, assigning them to priority tiers via drag-and-drop, configuring thresholds, and deploying the configuration to Home Assistant via WebSocket API.

## 3. Target Users

| User | Role | Technical Level |
|------|------|-----------------|
| Florian | System administrator, manages 3 installations | High -- can edit YAML, debug automations |
| Brother | End user at one installation | Low -- can use a web wizard, cannot edit YAML |
| Father | End user at one installation | Low -- can use a web wizard, cannot edit YAML |

## 4. System Context

### 4.1 Hardware

- **Inverter:** Huawei SUN2000-10KTL-MAP0
- **Battery:** Huawei LUNA2000-10KW-C1 (10 kWh usable capacity)
- **Backup Box:** Huawei SmartGuard-63A-T0 BackupBox
- **Multi-apartment house** with units: 410, 411, 420, 430

### 4.2 Controlled Devices

| Type | Examples |
|------|----------|
| Shelly switches | Various loads across apartments |
| MELCloud HVAC | Climate control units |
| Hue lights | Lighting across apartments |
| Samsung TV | Entertainment |
| Sonos | Audio |
| Compleo E-Box | EV wallbox charger |

## 5. Functional Requirements

### 5.1 Tier-Based Device Management

The system classifies devices into four categories:

| Tier | Label | Behavior | Typical Devices |
|------|-------|----------|-----------------|
| Tier 1 | `battery_guard_tier1` | Shut off immediately on outage | HVAC, water heaters, TV, EV charger |
| Tier 2 | `battery_guard_tier2` | Shut off when SOC drops below threshold (default: 30%) | Refrigerators, lights, non-critical switches |
| Tier 3 | `battery_guard_tier3` | Never shut off | Home Assistant, network equipment, septic system, cameras |
| Ignore | `battery_guard_ignore` | Excluded from monitoring and notifications | Devices intentionally unmanaged |

### 5.2 SOC Thresholds

- **FR-2.1:** Configurable SOC threshold for Tier 2 shutdown (default: 30%).
- **FR-2.2:** Configurable hysteresis value to prevent rapid on/off cycling (default: 5%).
- **FR-2.3:** Configurable critical SOC threshold for emergency warnings (default: 10%).

### 5.3 Auto-Recovery

- **FR-3.1:** When grid power returns, all devices restore to their pre-outage state.
- **FR-3.2:** When SOC recovers above threshold + hysteresis during an ongoing outage, Tier 2 devices turn back on.
- **FR-3.3:** Recovery respects a configurable delay to avoid rapid toggling during grid instability.

### 5.4 Notifications

- **FR-4.1:** Mobile app push notification on outage detection.
- **FR-4.2:** Persistent notification in HA UI showing current outage status.
- **FR-4.3:** Notification when Tier 2 devices are shut down (SOC threshold reached).
- **FR-4.4:** Notification when grid power is restored.
- **FR-4.5:** Critical notification at emergency SOC level.

### 5.5 Unassigned Device Detection

- **FR-5.1:** Template sensor that counts entities without a `battery_guard_*` label.
- **FR-5.2:** Automation that notifies when new unassigned devices are detected.

### 5.6 Setup Wizard

- **FR-6.1:** HA connection setup with Long-Lived Access Token authentication.
- **FR-6.2:** Automatic creation of required `battery_guard_*` labels in HA.
- **FR-6.3:** Device discovery showing all controllable entities from HA.
- **FR-6.4:** Drag-and-drop tier assignment interface.
- **FR-6.5:** Threshold configuration (Tier 2 SOC, hysteresis, critical SOC).
- **FR-6.6:** Notification target selection.
- **FR-6.7:** One-click deployment to HA via WebSocket API.
- **FR-6.8:** Entity recommendation engine suggesting tiers based on domain and name patterns.

## 6. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | All code, comments, labels, entity IDs, and documentation in English |
| NFR-2 | React SPA with TypeScript (strict mode) |
| NFR-3 | CI/CD pipeline via GitHub Actions |
| NFR-4 | 80%+ test coverage for service/logic modules |
| NFR-5 | Compatible with Home Assistant 2024.2+ (label system support) |
| NFR-6 | Deployable at multiple independent HA installations |
| NFR-7 | Wizard usable by non-technical users without documentation |

## 7. Out of Scope (v1.0)

- HACS integration packaging
- Multi-language UI (i18n)
- Automatic HA dashboard installation
- Energy consumption forecasting
- Multi-inverter support
- Backup configuration import/export

## 8. Success Criteria

1. Power outage triggers automatic Tier 1 shutdown within 10 seconds.
2. Battery lasts 3x longer during outage compared to no management.
3. Non-technical users can complete the setup wizard without assistance.
4. System deploys successfully across all 3 installations.
5. Zero false positives (devices shut off when grid is stable) over 30 days.
