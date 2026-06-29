# Concept #53 — Level-based SOC evaluation at outage start

Status: Implemented in v2.23.0-rc.1 (concept + code adversarially reviewed; fixes incorporated)
Issue: https://github.com/florianschupp/ha-battery-guard/issues/53
Epic: #52 · split from #49 (the reboot/critical-decoupling parts stay in #49,
blocked on the 3-state grid signal from #51).

## 1. Goal & Motivation
If a grid outage begins while the battery SOC is **already** below the tier-2 or
critical thresholds (e.g. drained to ~10% overnight, then a night outage), Battery
Guard sheds only tier 1 — tier-2 loads keep draining the near-empty battery and the
critical alarm may never sound. Cause: tier-2 shed and the critical alarm are
**edge-triggered** (downward crossing in `_handle_soc_change`); an outage that starts
below the threshold produces no crossing. This ticket adds a **level** evaluation at
outage start. It needs only the current SOC value — no grid-state distinction, no
reboot logic (those stay in #49).

## 2. Functional Description
At outage start, after tier 1 is shed, Battery Guard checks the current SOC:
- SOC < tier-2 threshold (and tier 2 not already shed) → shed tier 2 now.
- SOC < critical threshold → fire the critical alarm now.
No downward crossing required. Idempotent on re-entry (grid flicker, #45).

## 3. Technical Approach

### 3.1 Lock discipline (prevents the deadlock the concept review flagged)
`_on_power_outage` runs inside `async with self._operation_lock`
(automation_engine.py:323). `_on_soc_below_threshold` acquires the **same**
non-reentrant lock (automation_engine.py:470) → calling it from `_on_power_outage`
would deadlock. Fix:
- Extract the lock-holding body of `_on_soc_below_threshold` into a new lock-free
  `async _shed_tier2_locked(current_soc, threshold)` (assumes the lock is held).
- `_on_soc_below_threshold` becomes: `async with self._operation_lock:
  await self._shed_tier2_locked(...)` — behaviour unchanged for its existing caller.
- `_on_critical_soc` (automation_engine.py:556) is **already lock-free**, so it can be
  `await`-ed directly from `_on_power_outage`. (It also snapshots Tier-3 device
  states into the state_store — desirable at outage-start-critical; noted because it
  populates the store, which only matters for #49's reboot trigger, not here.)

### 3.2 Level evaluation in `_on_power_outage`
**Build the tier-1 notify message FIRST** (right after the tier-1 `tier_off`, reading
`last_action_result` at automation_engine.py:343-352), THEN run the level eval, THEN
send the already-built tier-1 notify. Otherwise `_shed_tier2_locked` overwrites
`last_action_result` and the tier-1 push would report tier-2 numbers (review B1).
`_shed_tier2_locked` sends its own "Tier 2 Off" notify, so tier-2 is still reported.

```
# (tier-1 message already assembled here from last_action_result)
soc = self._get_soc_value()           # None if unavailable/unknown
if soc is not None:
    t2 = self._get_threshold("tier2_threshold")
    if t2 is not None and soc < t2 and not self._get_switch_state("tier2_disabled"):
        await self._shed_tier2_locked(soc, t2)
    if soc < self._critical_soc and not self._critical_alerted:
        self._critical_alerted = True
        await self._on_critical_soc(soc)
# ... then send the pre-built tier-1 notify
```
Uses `<` to match the existing crossing comparison (`new_soc < threshold`). The
`tier2_disabled` guard is read exactly once per call → no intra-call double-shed.

### 3.3 Idempotency / de-dup (relates to #45)
- New engine attribute `self._critical_alerted: bool = False`.
- Set when the critical alarm fires (outage-start OR crossing path); guard both call
  sites with `not self._critical_alerted` so re-entry / repeated crossings do not
  re-alarm. (Re-entry of `_on_power_outage` happens while `active` stays ON, so the
  flag is not reset between re-entries → AC-3 holds.)
- **Reset trigger (review B2): reset `self._critical_alerted = False` only on a
  genuine `STATE_OFF` transition of the `active` switch** (not on any non-on state —
  a transient `unavailable`/`unknown` must NOT re-arm mid-emergency, code-review
  finding). The engine subscribes to the `active` switch via
  `async_track_state_change_event`; on `→ off` it clears the flag. This covers ALL
  emergency-end paths — grid-restored event, manual `restore_all` (clears `active`
  directly, services.py:359-375) — so a later below-critical outage re-arms.
- Tier-2 de-dup needs no new flag: the existing `tier2_disabled` switch already
  encodes "tier 2 is shed" and is checked before shedding.
- The `_on_critical_soc` T3 snapshot uses `StateStore.save_state`, which is
  first-save-wins (state_store.py:85-87) → firing it at outage start instead of on a
  crossing is safe and non-corrupting.

## 4. Security Aspects
- Additive to the emergency path; no new external surface, no new dependency.
- Conservative under uncertainty: SOC unavailable ⇒ no level action (tier 1 already
  shed). Idempotency prevents duplicate device commands / alarm spam.
- Lock-free helper keeps the single-lock discipline intact (no deadlock, no nested
  acquire).

## 5. Privacy Impact Assessment (DSFA)
| Aspect | Assessment |
|---|---|
| PII | None — battery SOC + device states only. |
| New storage | None beyond the existing state_store (T3 snapshot already exists). |
| External transmission | Only via already-configured notify services. |
| Result | No DSFA relevance. |

## 6. Affected Files
- `custom_components/battery_guard/automation_engine.py` — extract
  `_shed_tier2_locked`; build tier-1 message before level eval; level eval in
  `_on_power_outage`; `_critical_alerted` flag + guard in `_handle_soc_change`
  critical branch; subscribe to the `active` switch in `async_start` and reset the
  flag on `→ off` (unsubscribe in `async_stop`).
- `tests/test_automation_engine.py` (+ new cases).
- this concept.

## 7. Verification
- Unit: outage start with SOC < tier2 (tier2 not disabled) ⇒ tier 2 shed; SOC <
  critical ⇒ critical alarm. SOC unavailable ⇒ no level action, no crash. Re-entry of
  `_on_power_outage` ⇒ no second tier-2 shed (tier2_disabled) and no second critical
  alarm (`_critical_alerted`). Healthy SOC ≥ tier2 ⇒ only tier 1 shed (unchanged).
  `_on_soc_below_threshold` still works for its existing crossing caller (regression).
  `_critical_alerted` resets on grid restore ⇒ next outage can alarm again.
- No deadlock: `_on_power_outage` completes (tier-1 notify sent) when SOC is low.

## 8. Acceptance Criteria
1. At outage start, current SOC is evaluated by level: SOC < tier2_threshold (and
   tier 2 not already disabled) ⇒ tier 2 shed immediately; SOC < critical ⇒ critical
   alarm immediately — no downward crossing required.
2. SOC unavailable/unknown at outage start ⇒ no level action, no crash (tier 1 still
   shed as before).
3. Idempotent: re-entry of `_on_power_outage` does not double-shed tier 2 or re-fire
   the critical alarm; the critical flag resets on grid restore.
4. Existing crossing-based handlers keep working (no regression); duplicate critical
   alarms on repeated crossings are prevented by the same flag.
5. Healthy SOC at outage start (≥ tier2_threshold) ⇒ only tier 1 shed, unchanged.
6. The critical flag re-arms whenever emergency ends: after `restore_all` (or any
   path that turns `active` off), a subsequent below-critical outage re-fires the
   critical alarm.
7. The tier-1 outage notification still reports tier-1 device counts (not tier-2),
   even when tier 2 is shed in the same outage-start.
