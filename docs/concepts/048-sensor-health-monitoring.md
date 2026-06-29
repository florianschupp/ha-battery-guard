# Concept #48 — Sensor Health Monitoring (E2)

Status: Implemented in v2.22.0-rc.2 (concept + code adversarially reviewed; staging feedback incorporated)
Issue: https://github.com/florianschupp/ha-battery-guard/issues/48
Epic: #52 (Robustness against cloud/total power outage)

## 1. Goal & Motivation

When the link to the PV system drops and Battery Guard's source sensors become
`unavailable`, Battery Guard currently does nothing and gives no feedback — the
power-outage binary sensor silently treats an unavailable grid sensor as "no
outage" (`binary_sensor.py:128`). The user cannot tell that monitoring has gone
blind. This feature makes blindness **visible**: notification + log + a status
page. It deliberately does NOT change detection logic (that is issue #51/E).

Scope decision (owner, 2026-06-02): for now, report **every** required-sensor
outage, not only the detection-critical grid+SOC sensors.

## 2. Functional Description

- Battery Guard continuously knows which source entities it depends on and watches
  their availability.
- If a required sensor is `unavailable`/`unknown`/missing for longer than a
  debounce window, a notification is sent ("⚠️ Battery Guard: sensor X
  unavailable — monitoring degraded").
- When it recovers, a follow-up notification is sent ("✓ sensor X available
  again") — but only if an "unavailable" notification was previously sent for it.
- Events are logged.
- A health page in the panel lists each required sensor: role, entity_id, current
  state, available yes/no, last-seen timestamp.
- Brief dropouts do not raise alarms (debounce + flapping protection).

## 3. Technical Approach

### 3.1 Required-sensor set (derived from `entry.data`) — REVISED per review
Include an entity ONLY if its config value is a **non-empty entity_id**
(`grid_sensor`/`soc_sensor` default to `""` and are set later via the Options
flow — empty values must NOT be reported as "missing"):
- Detection source: if `CONF_USE_VOLTAGE` → `CONF_VOLTAGE_PHASE_A/B/C` (the 3
  phases are treated as **one logical "detection source"** for alerting to avoid 3
  simultaneous alerts on a Shelly reboot); else `CONF_GRID_SENSOR` if non-empty.
- `CONF_SOC_SENSOR` if non-empty.
- `CONF_BATTERY_OPTIMIZATION` entities **only if** `enabled` (confirmed gate at
  `automation_engine.py:232`).
- EXCLUDED: `CONF_BATTERY_CHARGE_ENTITY` / `CONF_BATTERY_DISCHARGE_ENTITY` — these
  are stored/echoed only and consumed by **no** runtime logic, so their
  unavailability degrades nothing. Do not monitor/alert on them.
Each retained entry carries a human-readable `role` label for UI/notification.

### 3.2 New module `sensor_health.py` (fail-isolated)
A `SensorHealthMonitor` class, deliberately **separate** from
`automation_engine.py` so a watchdog bug cannot disturb outage/restore logic
(fail-securely). It:
- builds the required-sensor set on start,
- **seeds initial status from `hass.states.get()`** for entities already present
  (state-change events do not fire for pre-existing states — mirror
  `binary_sensor.py:107`),
- subscribes via `async_track_state_change_event` to those entities, storing unsub
  handles (like the engine's `_unsub_listeners`),
- maintains per-entity status `{available, state, last_available, role, alerted}`,
- on transition to unavailable: starts a per-entity debounce timer
  (`HEALTH_DEBOUNCE_SECONDS`, default 60s via `async_call_later`); if still
  unavailable when it fires → notify + log, set `alerted=True`,
- on transition to available: cancel any pending debounce; if `alerted` → recovery
  notify + `alerted=False`,
- runs a one-shot startup check after a grace delay that **reads current state**
  (not just accumulated events) so a sensor unavailable-at-startup-and-static is
  still reported once,
- publishes the snapshot to `hass.data[DOMAIN]["sensor_health"]`.
- `async_stop()` cancels all pending debounce timers AND unsubs all listeners.

### 3.3 Notifications & logging
- Reuse the existing `battery_guard.notify` service (schema `services.py:461`:
  `title`/`message`/`critical`), `critical=False`. Reliability backstop: that
  handler always also fires `persistent_notification.create` (`services.py:424`),
  so health alerts surface in the HA UI **even if `notify_services` is empty/stale
  (#44)** — AC #2 is therefore NOT gated on #44.
- `_LOGGER.warning` on unavailable, `_LOGGER.info` on recovery.

### 3.4 Health data exposure — REVISED per review
- New read-only websocket command `battery_guard/get_sensor_health` following the
  `ws_get_*` pattern (`@callback`, in-memory snapshot).
- **Register the command only once** (guard via a flag in `hass.data[DOMAIN]`),
  because `async_register_websocket_api` runs per config entry
  (`__init__.py:261`).
- Add **`"single_config_entry": true`** to `manifest.json`. This matches the
  de-facto "first entry wins" assumption already pervasive in `ws_get_config` /
  `handle_notify`, and removes the multi-entry snapshot-collision risk. (Single
  inverter system per install → acceptable constraint.)

### 3.5 Panel health page
- New section/view in the wizard frontend (candidate: `SystemSettingsView.tsx` or
  a dedicated `HealthView.tsx`) that calls `get_sensor_health` and renders a table
  with green/red availability + last-seen. Build via `npm run build`, copy `dist/`
  to `frontend/`.

### 3.6 Flapping protection
Notify only on debounced transitions. Suppress repeat "unavailable" notifications
for the same entity until it has recovered (`alerted` flag). NOTE: `alerted` +
pending timers reset on config-entry reload — a sensor unavailable across a reload
may re-alert once; acceptable.

## 4. Security Aspects
- Purely additive + read-only: reads states, sends notifications; no control
  actions, cannot toggle devices.
- Fail-isolated from the automation engine (separate module, no shared locks).
- New attack surface: one read-only websocket command + one panel page. No new
  external connection. No new dependency.

## 5. Privacy Impact Assessment (DSFA)
| Aspect | Assessment |
|---|---|
| Personal data (PII) | None — only entity IDs and HA states. |
| New data storage | None persisted; in-memory snapshot only. |
| External transmission | Only via the user's already-configured notify services. |
| Result | No DSFA relevance. |

## 6. Affected Files
- NEW `custom_components/battery_guard/sensor_health.py`
- `custom_components/battery_guard/__init__.py` (start monitor; **teardown in
  `async_unload_entry`**: stop + pop `hass.data` slot)
- `custom_components/battery_guard/manifest.json` (**`single_config_entry: true`**)
- `custom_components/battery_guard/websocket_api.py` (`ws_get_sensor_health`,
  register-once guard)
- `custom_components/battery_guard/const.py` (`HEALTH_DEBOUNCE_SECONDS`, titles)
- `wizard/src/steps/` (health view) + `services/` (ws call) + `types/`
- rebuilt `custom_components/battery_guard/frontend/` (wizard `dist`)
- tests

## 7. Verification
- Unit: entity → unavailable > debounce ⇒ notify once; recovery ⇒ notify; rapid
  toggle ⇒ no spam; missing entity ⇒ reported once; **empty-string grid/soc ⇒ zero
  alerts**; voltage-mode watches 3 phases as one logical source; battery-opt
  entities only when `enabled`; charge/discharge entities never monitored;
  unavailable-at-startup static sensor ⇒ reported via startup check.
- Manual: take a source sensor offline ⇒ notification + health page red + last-seen;
  restore ⇒ recovery notification + green.

## 8. Acceptance Criteria (confirmed 2026-06-02; AC #4 revised after review)
1. Monitors all required source sensors (grid_sensor or 3 voltage phases, SOC
   sensor, enabled battery-optimization entities), excluding empty/unconfigured
   values and the unused charge/discharge entities.
2. Required sensor unavailable/unknown/missing > debounce ⇒ notification (push if
   configured, plus the persistent_notification UI backstop).
3. Recovery reported.
4. **[REVISED]** Unavailability/recovery events are emitted to the HA log
   (`_LOGGER.warning`/`info`). Integration into a structured activity log is
   deferred to #21/#27 (not in scope here).
5. Panel health page shows per sensor: name, state, available, last-seen.
6. No false alarms on brief dropouts (debounce + flapping protection); an
   unconfigured (empty) grid/soc sensor produces zero alerts.
7. **[added rc.2]** The Configuration page shows a live "unavailable" warning
   next to each configured sensor ID (refreshed every 15s).

## Staging feedback (rc.1 → rc.2)
- Health page "Refresh" button gave no visible feedback → added a spinner +
  "Updated <time>" timestamp.
- Added per-sensor unavailable warnings on the Configuration page (AC #7), with a
  15s live refresh so the badges never go stale.
