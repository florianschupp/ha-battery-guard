# Concept #51 Part A — Off-grid status mapping (safety-first)

Status: Implemented in v2.23.0-rc.2 (concept review caught a substring regression →
redesigned to normalized exact-match; code review verified against the real Huawei enum)
Issue: https://github.com/florianschupp/ha-battery-guard/issues/51 (Part A)
Epic: #52

## 1. Goal & Motivation
The grid-based power-outage sensor recognises off-grid via an exact set membership
test (`state.state.lower() in GRID_OFF_STATES`, binary_sensor.py:31,131). The real
Huawei off-grid device-status values (`"Off-grid mode: running"`, `"Running: off-grid
charging"`) are NOT in that set → a genuine off-grid state is missed. This part adds
the **real** Huawei off-grid values and normalises whitespace, while keeping the
matcher **exact** (not substring) for safety.

**Safety principle (owner, top priority):** *a connection/communication loss must
NEVER be interpreted as off-grid* — otherwise we shed load for nothing. Every
uncertainty fails safe = no shed. The concept review proved that substring matching
violates this (`disconnected` matches the real Huawei value `"Shutdown: communication
disconnected"`, a comms loss with the grid fine → false tier-1 shed). Exact match +
removing ambiguous tokens enforces the principle.

Deferred to #49: the "honest 3-state / report unavailable" idea (would regress
detection — `unavailable→on` is skipped in `_handle_power_outage_change`:170-171).

## 2. Functional Description
Off-grid is recognised by a normalized (strip + lowercase) **exact** match against a
curated allow-list of unambiguous off-grid values. Ambiguous tokens that can mean a
comms loss or an inverted binary (`disconnected`, `off`) are removed. The user's
actual off-grid value is captured precisely in Part B (once the local Modbus entity
is connected) and added knowingly if needed.

## 3. Technical Approach

### 3.1 New pure module `grid_status.py` (no HA imports → unit-testable)
```python
# Normalized (strip + lowercase) values that POSITIVELY indicate off-grid.
# Exact match only — substring matching is unsafe here ("off-grid" also appears in
# config labels like "Off-grid switch disabled", and "disconnected" appears in the
# comms-loss status "Shutdown: communication disconnected").
GRID_OFF_STATES = frozenset({
    "off-grid", "off_grid", "offgrid",         # generic off-grid
    "off-grid mode: running",                  # Huawei DEVICE_STATUS
    "running: off-grid charging",              # Huawei DEVICE_STATUS
})

def state_indicates_outage(raw: str | None) -> bool:
    """True only for a positive, unambiguous off-grid status. Fails safe."""
    return (raw or "").strip().lower() in GRID_OFF_STATES
```
Removed vs today: bare `"disconnected"` (comms/component loss) and `"off"` (a plain
binary_sensor's `off` means *healthy*). Neither is emitted by any documented Huawei
grid-status value, so the practical loss is nil while the safety gain is real.

### 3.2 `binary_sensor.py`
- `PowerOutageGridSensor._update_from_grid_state`: keep the unchanged
  unavailable/unknown guard (→ `is_on = False`), then
  `self._attr_is_on = state_indicates_outage(state.state)`.
- Remove the module-level `GRID_OFF_STATES` set (now in `grid_status.py`).
- `PowerOutageVoltageSensor` untouched.

## 4. Security Aspects
- Pure string classification; no new surface/dependency/control action.
- Fail-safe by construction: only a positive off-grid string sheds load; comms loss
  (`unavailable`, comms-fault strings, removed ambiguous tokens) never does.
- Exact match removes the entire substring false-positive class.

## 5. Privacy Impact Assessment (DSFA)
| Aspect | Assessment |
|---|---|
| PII | None — a grid status string. |
| Storage / transmission | None new. |
| Result | No DSFA relevance. |

## 6. Conscious limitations
- **Localization:** the allow-list is English. If the Huawei integration runs in
  German, off-grid values differ and won't match → captured exactly in Part B
  (i18n-gate: deliberate limitation, follow-up in Part B). Detection logic is
  admin/backend, not guest-facing.
- **grid_sensor should be a status sensor**, not a plain on/off binary_sensor.

## 7. Affected Files
- NEW `custom_components/battery_guard/grid_status.py`
- `custom_components/battery_guard/binary_sensor.py` (use matcher; drop the set)
- NEW `tests/test_grid_status.py` (pure unit tests)

## 8. Verification
Unit tests (pure):
- Off-grid ⇒ True: `"off-grid"`, `"Off-Grid"`, `"  OFF-GRID  "`, `"off_grid"`,
  `"offgrid"`, `"Off-grid mode: running"`, `"Running: off-grid charging"`.
- Comms-loss / benign ⇒ False (safety): `"Shutdown: communication disconnected"`,
  `"disconnected"`, `"Off-grid switch disabled"`, `"Off-grid switch enabled"`,
  `"On-grid"`, `"Grid-connected normally"`, `"Standby"`, `"off"`, `"standoff"`,
  `"shutoff"`, `""`, `None`, `"backup mode"`.

## 9. Acceptance Criteria
1. **SAFETY (top priority):** a connection/communication loss never yields off-grid →
   no shed. `unavailable`/`unknown`/empty, `"Shutdown: communication disconnected"`,
   `"Off-grid switch disabled/enabled"`, and a binary `"off"` all ⇒ NOT outage
   (mandatory regression tests).
2. Real Huawei off-grid values (`"Off-grid mode: running"`, `"Running: off-grid
   charging"`) + generic `off-grid`/`off_grid`/`offgrid` ⇒ outage (normalized,
   case-insensitive).
3. Availability behaviour unchanged (`unavailable`/`unknown`/empty ⇒ `is_on = False`).
4. Voltage-mode sensor unchanged.
5. Deliberate change: the ambiguous tokens `off` and `disconnected` are removed
   (safety > theoretical backward-compat); the user's real off-grid value is added in
   Part B if it differs.
