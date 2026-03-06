# HA Battery Guard -- Technical Architecture

**Version:** 1.0
**Date:** 2026-03-06

---

## 1. Architecture Overview

HA Battery Guard is structured as a monorepo with two distinct components:

```
claude_homeassistant/
  packages/battery_guard/     # HA YAML packages (automation logic)
    helpers.yaml
    templates.yaml
    scripts.yaml
    automations.yaml
    dashboard.yaml
  wizard/                     # React SPA (setup wizard)
    src/
    dist/                     # Built output, deployed to HA www folder
  docs/
  .github/workflows/
```

### Design Principles

- **Label-based targeting:** All device tier assignments use HA's native label system. Automations use `label_entities()` to dynamically resolve device lists at runtime -- no hardcoded entity IDs.
- **Separation of concerns:** YAML packages handle all runtime automation. The wizard handles setup and configuration only.
- **Stateless wizard:** The wizard reads current state from HA and writes changes back. It holds no persistent state of its own.

## 2. YAML Packages

All automation logic lives in `packages/battery_guard/` and is loaded via HA's [packages mechanism](https://www.home-assistant.io/docs/configuration/packages/).

### 2.1 helpers.yaml

Input helpers for user-configurable values:

| Entity | Type | Default | Purpose |
|--------|------|---------|---------|
| `input_number.battery_guard_soc_threshold` | input_number | 30 | SOC % at which Tier 2 shuts down |
| `input_number.battery_guard_hysteresis` | input_number | 5 | SOC % buffer to prevent cycling |
| `input_number.battery_guard_critical_soc` | input_number | 10 | SOC % for emergency alert |
| `input_boolean.battery_guard_outage_active` | input_boolean | off | Tracks whether an outage is in progress |
| `input_boolean.battery_guard_tier2_shutdown` | input_boolean | off | Tracks whether Tier 2 has been shut down |

### 2.2 templates.yaml

Template sensors derived from HA state:

| Entity | Type | Logic |
|--------|------|-------|
| `binary_sensor.battery_guard_power_outage` | binary_sensor | Detects grid loss via Huawei inverter sensor |
| `sensor.battery_guard_unassigned_count` | sensor | Counts entities that have no `battery_guard_*` label |

The outage sensor monitors the Huawei inverter's grid status. The unassigned count sensor iterates all controllable entities and filters for those missing any `battery_guard_tier1`, `battery_guard_tier2`, `battery_guard_tier3`, or `battery_guard_ignore` label.

### 2.3 scripts.yaml

Four reusable scripts for device control:

| Script | Function |
|--------|----------|
| `script.battery_guard_shutdown_tier1` | Turn off all entities with `battery_guard_tier1` label |
| `script.battery_guard_shutdown_tier2` | Turn off all entities with `battery_guard_tier2` label |
| `script.battery_guard_restore_tier1` | Turn on all entities with `battery_guard_tier1` label |
| `script.battery_guard_restore_tier2` | Turn on all entities with `battery_guard_tier2` label |

Each script uses `label_entities('battery_guard_tierN')` to dynamically resolve the list of target entities at execution time. This means adding or removing a device from a tier requires only a label change -- no automation edits.

### 2.4 automations.yaml

Six automations handle the complete outage lifecycle:

| # | Automation | Trigger | Action |
|---|-----------|---------|--------|
| 1 | Outage detected | `binary_sensor.battery_guard_power_outage` turns on | Set outage flag, run Tier 1 shutdown, send notification |
| 2 | Low SOC | SOC drops below threshold while outage active | Set Tier 2 flag, run Tier 2 shutdown, send notification |
| 3 | SOC recovery | SOC rises above threshold + hysteresis while outage active | Clear Tier 2 flag, run Tier 2 restore |
| 4 | Grid restored | `binary_sensor.battery_guard_power_outage` turns off | Clear flags, restore all tiers, send notification |
| 5 | Critical SOC | SOC drops below critical threshold | Send critical notification |
| 6 | Unassigned detected | `sensor.battery_guard_unassigned_count` rises above 0 | Send persistent notification listing unassigned entities |

### 2.5 dashboard.yaml

Lovelace dashboard configuration providing:

- Current outage status and SOC display
- Tier assignment overview using the auto-entities HACS card
- Threshold controls (input_number sliders)
- Unassigned device list

## 3. Setup Wizard

### 3.1 Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI framework, chosen for HA JS WebSocket lib compatibility |
| TypeScript (strict) | Type safety |
| Vite | Build tooling, fast dev server and optimized production builds |
| Shadcn/ui | Accessible, composable UI components with zero runtime deps |
| Tailwind CSS | Utility-first styling |
| @dnd-kit | Drag-and-drop for tier assignment |
| home-assistant-js-websocket | Official HA WebSocket client library |

### 3.2 Wizard Flow

The wizard is a 7-step linear flow:

```
Step 1: Connection
  Enter HA URL + Long-Lived Access Token
  Validate connection via WebSocket
      |
Step 2: Labels
  Check for existing battery_guard_* labels
  Create missing labels automatically
  Handle migration from legacy German labels
      |
Step 3: Discovery
  Fetch all entities from HA entity registry
  Filter to controllable domains (switch, light, climate, media_player, etc.)
  Display with current label assignments
      |
Step 4: Assignment
  Drag-and-drop interface with 4 columns (Tier 1, Tier 2, Tier 3, Ignore)
  Unassigned pool at the top
  Entity recommendation engine pre-sorts devices
  Bulk selection support
      |
Step 5: Thresholds
  Configure SOC threshold, hysteresis, critical SOC
  Visual preview of trigger points
      |
Step 6: Notifications
  Select notification targets (mobile_app devices, persistent notification)
  Optional: test notification
      |
Step 7: Deploy
  Summary of all changes
  Apply label assignments via entity registry API
  Set input_number values via call_service
  Show deployment result
```

### 3.3 State Management

```
React Context + useReducer
  |
  +-- ConnectionState: url, token, wsConnection
  +-- LabelState: existing labels, created labels
  +-- EntityState: all entities, filtered entities
  +-- AssignmentState: Map<entity_id, tier>
  +-- ThresholdState: soc, hysteresis, critical
  +-- NotificationState: selected targets
  +-- DeployState: progress, results, errors
```

No external state library (Redux, Zustand) -- the wizard's state is ephemeral and scoped to a single session.

### 3.4 Entity Recommendation Engine

The wizard suggests tier assignments based on domain and entity name patterns:

| Pattern | Suggested Tier |
|---------|---------------|
| `climate.*` | Tier 1 |
| `water_heater.*` | Tier 1 |
| `media_player.*` (TV) | Tier 1 |
| Entity name contains `wallbox`, `charger`, `ev` | Tier 1 |
| `light.*` | Tier 2 |
| Entity name contains `fridge`, `refrigerator`, `freezer` | Tier 2 |
| `switch.*` (generic) | Tier 2 |
| Entity name contains `home_assistant`, `router`, `nas`, `network` | Tier 3 |
| Entity name contains `camera`, `security`, `septic` | Tier 3 |

Suggestions are displayed as defaults in the assignment step; users can override any suggestion.

## 4. HA WebSocket API Usage

The wizard communicates with HA exclusively via WebSocket:

| API Call | Purpose |
|----------|---------|
| `config/label_registry/list` | Fetch existing labels to check for `battery_guard_*` labels |
| `config/label_registry/create` | Create missing `battery_guard_*` labels |
| `config/entity_registry/list` | Fetch all registered entities with their current labels |
| `config/entity_registry/update` | Assign/update labels on entities |
| `call_service` | Set `input_number` values for thresholds |

### Label Assignment Merge Logic

When updating entity labels, the wizard must **merge** rather than replace. An entity may have labels from other systems (e.g., `area_kitchen`, `floor_1`). The update logic:

1. Fetch current labels for the entity.
2. Remove any existing `battery_guard_*` labels.
3. Add the new `battery_guard_tierN` label.
4. Send the merged label list via `config/entity_registry/update`.

## 5. Deployment

### 5.1 File Placement

```
/config/
  packages/
    battery_guard/
      helpers.yaml
      templates.yaml
      scripts.yaml
      automations.yaml
      dashboard.yaml
  www/
    battery-guard/
      index.html
      assets/
        *.js
        *.css
```

### 5.2 Access

- **Direct URL:** `http://<ha-ip>:8123/local/battery-guard/index.html`
- **Sidebar integration (optional):** Add `panel_custom` entry with `embed_iframe` to `configuration.yaml`

### 5.3 Release Artifact

GitHub Releases publishes a ZIP file containing:

```
battery-guard-v1.0.0.zip
  packages/battery_guard/    # Copy to /config/packages/
  www/battery-guard/         # Copy to /config/www/
  README.txt                 # Installation instructions
```

### 5.4 CI/CD Pipeline

```
GitHub Actions:
  on push to main:
    - Lint (ESLint + yamllint)
    - Unit tests (Vitest)
    - Build wizard (Vite)
  on release tag:
    - Build wizard
    - Package ZIP (YAML + dist)
    - Upload to GitHub Release
```

## 6. Security Considerations

- **Authentication:** Long-Lived Access Token stored in browser sessionStorage (cleared on tab close). Never persisted to localStorage.
- **Network:** Wizard communicates only with the HA instance via WebSocket. No external API calls.
- **CORS:** Not applicable when served from HA's www folder (same origin).
- **Permissions:** The token must have admin access for label and entity registry operations.
