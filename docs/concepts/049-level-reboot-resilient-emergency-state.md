# Concept #49 — Level- & reboot-resilient emergency state

Status: Superseded — concept review found the design needs a reliable 3-state grid
signal that does not exist yet. Split: the level-based SOC part shipped as #53
(concept 053); the reboot-restore + critical-decoupling parts stay in #49, blocked on
the grid-signal foundation (#51 / E). Kept for the design rationale.
Issue: https://github.com/florianschupp/ha-battery-guard/issues/49
Supersedes: #50 (critical-SOC decoupling, folded in as AC-2)
Epic: #52 (Robustness against cloud/total power outage)

## 1. Goal & Motivation

Battery Guard's emergency response is **edge-triggered** (reacts to state
*transitions*), not **level-triggered** (acts on the *current* state). Three real
situations break because of this:

1. **Outage starts with SOC already below threshold** (battery drained to ~10%
   overnight, then a night outage). `_on_power_outage` sheds only tier 1; tier-2
   shed + critical alarm fire only on a *downward crossing* in `_handle_soc_change`
   — which never happens if SOC was already below. Tier-2 loads keep draining the
   near-empty battery.
2. **Reboot mid-outage** (full drain → house + HA die → power returns → HA reboots).
   Saved device states persist but nothing re-triggers restore; `_on_grid_restored`
   needs a live transition that never comes after a reboot. Fridges/boilers/AC stay
   off.
3. **Critical alarm coupled to outage detection** (former #50): the critical-SOC
   alarm sits behind the `emergency_active` guard, so it never fires when no clean
   outage transition was detected.

**Unifying principle:** *On entry AND on resume of the emergency state, evaluate
grid + SOC by LEVEL, not only by transition* — reusing the existing restore /
recovery logic.

## 2. Functional Description

### 2.1 Level-based evaluation at outage start
When an outage is detected, after shedding tier 1, Battery Guard evaluates the
**current** SOC: if already ≤ tier-2 threshold → shed tier 2 now; if already ≤
critical → critical alarm now. No downward crossing required.

### 2.2 Critical alarm by level (decouples #50)
The critical-SOC alarm fires whenever SOC ≤ critical **unless the grid is positively
confirmed present (on-grid)**. Rationale: on confirmed grid, a low battery is not an
immediate house-power risk (grid supplies the house); but if the grid is off-grid,
unknown, or the signal is unavailable, a low battery IS critical → warn (fail-loud).
This satisfies #50 (alarm not gated on a detected outage) without spurious alarms
during normal on-grid low-battery periods (the owner's overnight-drain case is then
handled at outage-start by 2.1).

### 2.3 Reboot reconstruction
On startup, if saved device states exist, reconstruct the emergency state from the
**current** grid + SOC once devices are available (grace + retry), instead of
waiting for a live transition. Restore keys on **grid-back (on-grid)**, never on
"HA booted" or "battery recharged off-grid":

| State at boot (saved states present) | Action |
|---|---|
| Grid present (on-grid) | Full staggered restore (respect `stay_off`), clear store, notify |
| Off-grid, SOC ≥ recovery threshold | Restore **tier 2 only**; tier 1 stays shed; emergency stays active; keep store |
| Off-grid, SOC < recovery threshold | Restore nothing; conservation continues; keep store |
| Grid/SOC signal unavailable | Wait (timeout); loads stay off (safe default) |

## 3. Technical Approach

### 3.1 Shared level evaluator
Extract a `_evaluate_soc_levels(current_soc, *, in_emergency)` helper that applies,
idempotently, the tier-2 shed (if SOC ≤ tier2_threshold and not already disabled)
and the critical alarm (per 2.2). Reuse the existing `_on_soc_below_threshold`
(tier-2 off + flag + notify) and `_on_critical_soc` bodies — do not duplicate.

- Call it from `_on_power_outage` (after tier-1 shed) → fixes 2.1.
- Call the **critical-alarm** part from `_handle_soc_change` regardless of
  `emergency_active`, gated only by "grid not positively on-grid" → fixes 2.2.
  Keep tier-2/recovery crossing logic for the dynamic falling/rising case.

### 3.2 Critical alarm decoupling
Move the critical-SOC evaluation in `_handle_soc_change` out of the
`if not active: return` early-return (automation_engine.py:433-435). Add hysteresis
(an `_critical_alerted` flag cleared when SOC rises back above critical + margin) to
prevent spam. Determine "grid positively on-grid" from the power_outage binary
sensor: outage sensor `off` AND available ⇒ on-grid; `on`/unavailable/unknown ⇒ not
confirmed on-grid.

### 3.3 Reboot reconstruction
A new `async_reconstruct_after_restart()` on the engine (or a dedicated helper),
invoked from `async_setup_entry` when `state_store.has_saved_states`. It:
- waits a startup grace + for the SOC/grid entities to become available (timeout),
- reads grid status + SOC, branches per the §2.3 table,
- on-grid → `restore_all` (existing, respects `stay_off`/staggering) + clear store +
  notify; re-arm normal mode (clear `active`/`tier2_disabled`),
- off-grid + SOC≥recovery → `tier_on(TIER2)` semantics (existing `_on_soc_recovered`
  path) but keep `active`; off-grid + low → keep shed, keep `active` so live SOC
  management + critical alarm continue,
- unavailable → schedule a retry until timeout; loads stay off.

### 3.4 Idempotency / re-entry (relates to #45)
`_on_power_outage` can be re-entered on grid flicker. The level evaluator must be
idempotent: tier-2 shed guarded by `tier2_disabled`, critical alarm guarded by
`_critical_alerted`. No duplicate shedding or alarms on re-entry.

## 4. Security Aspects
- **Fail-securely is the core safety property:** full restore happens ONLY on
  positively-confirmed on-grid. Off-grid / unknown / unavailable ⇒ never restore
  (would re-drain the island and risk another blackout). Conservative default
  everywhere uncertainty exists.
- No new external surface, no new dependency. Reuses existing services
  (`tier_off`/`tier_on`/`restore_all`/`notify`) and `restore_config`.
- Idempotency prevents duplicate device commands / alarm spam.

## 5. Privacy Impact Assessment (DSFA)
| Aspect | Assessment |
|---|---|
| Personal data (PII) | None — device states + battery SOC only. |
| New storage | None beyond the existing `state_store`. |
| External transmission | Only via already-configured notify services. |
| Result | No DSFA relevance. |

## 6. Affected Files
- `custom_components/battery_guard/automation_engine.py` — `_on_power_outage` level
  eval; `_handle_soc_change` critical decoupling + hysteresis; shared
  `_evaluate_soc_levels`; new `async_reconstruct_after_restart`.
- `custom_components/battery_guard/__init__.py` — invoke reconstruction on startup
  when saved states exist.
- `custom_components/battery_guard/const.py` — reconstruction grace/timeout, critical
  hysteresis margin.
- `tests/test_automation_engine.py` (+ new cases).
- this concept.

## 7. Verification
- Unit: outage start with SOC already < tier2 ⇒ tier 2 shed immediately; SOC <
  critical ⇒ alarm immediately. Critical alarm fires when off-grid/unknown but NOT
  when outage-sensor confirms on-grid. Reboot reconstruction: on-grid ⇒ full restore
  (stay_off honoured); off-grid+SOC≥recovery ⇒ tier 2 only, tier 1 stays off,
  emergency stays active; off-grid+low ⇒ nothing restored, active stays on;
  signal unavailable ⇒ no restore (waits). No saved states ⇒ no startup action.
  Re-entry of `_on_power_outage` ⇒ no duplicate shed/alarm. Healthy SOC on-grid ⇒
  no spurious shed/alarm.
- Manual (staging): simulate the three scenarios where feasible.

## 8. Acceptance Criteria (draft — finalize after review)
1. At outage start, current SOC is evaluated by level: ≤ tier2_threshold ⇒ tier 2
   shed immediately; ≤ critical ⇒ critical alarm immediately (no crossing needed).
2. Critical-SOC alarm fires by level whenever SOC ≤ critical and the grid is not
   positively confirmed on-grid — independent of `emergency_active` (former #50);
   with hysteresis to avoid spam.
3. After reboot with saved states, the emergency state is reconstructed from current
   grid + SOC per the §2.3 table, reusing the existing restore/recovery logic.
4. Full restore happens only when the grid is confirmed present (on-grid) — never on
   boot alone or on off-grid battery recharge.
5. Restore reuses `restore_config`: `stay_off` respected, staggering applied, store
   cleared + notification after success.
6. No misbehaviour in normal operation: no saved states ⇒ no startup restore; healthy
   on-grid SOC ⇒ no spurious shed/alarm.
7. Under unavailable grid/SOC signal: stay conservative (no restore); surfaced via
   the E2 watchdog.
8. `_on_power_outage` re-entry (grid flicker) causes no duplicate shedding or alarms.
