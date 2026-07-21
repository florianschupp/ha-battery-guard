# Concept #56 — Detect and report when Battery Guard cannot protect

Status: ✅ Accepted & released in v2.25.0 (2026-07-21).
Issue: https://github.com/florianschupp/ha-battery-guard/issues/56
Epic: #52 · precedes #58 (which reuses the periodic sweep introduced here) · UI in #57.

## 1. Goal & Motivation

Battery Guard depends on paths that can fail **silently**, and today it only notices
some of those failures — and only late. Three gaps, all with the same shape ("a path
Battery Guard relies on fails without anyone noticing until it matters"):

- **Sensor health.** The current `SensorHealthMonitor` is purely event-driven: it reacts
  only to a clean `available → unavailable` state-change event plus a 60 s debounce. Two
  real failure modes slip through — a **frozen** sensor (stops updating, keeps its last
  value → no event fires) and a **flapping** sensor (dropouts shorter than 60 s reset the
  debounce). Both were observed in the operator's own data on 2026-07-19: the Shelly EM3
  phase readings sat as three perfectly flat lines for ~23 minutes during the incident
  (proof of the frozen mode). Only an HA restart forces sensors hard to `unavailable`,
  which the one-shot startup check catches — hence "alert only on restart, hours late".

- **Control path.** Battery Guard knows, via tier labels, which devices it must shed. If
  such a device is unavailable it **cannot be shed** during an outage — the core function
  is degraded, exactly like a missing sensor, but nothing reports it.

- **Shedding honesty.** After an outage shed, the notification can report success for a
  device that was never actually switched, because the shed path never checks
  availability. During the 2026-07-19 single-phase trip the operator could only *suspect*
  the shed misbehaved ("Abwurf war m.E. gestört") — Battery Guard's own report did not
  make it clear.

## 2. Functional Description

1. **Dead:** a monitored source continuously unavailable beyond the debounce → one alert.
2. **Frozen:** a source that is nominally "available" but has reported no fresh value for
   more than `X` minutes → one alert. (`last_reported`, HA ≥ 2024.8, ticks on every
   report even when the value is unchanged — the correct freshness signal.)
3. **Flapping:** a source with ≥ `N` unavailable transitions inside a rolling window `W`
   → one "connection unstable" alert.
4. **No spam / recovery / no startup false alarms:** one alert per degraded episode; a
   recovery notice on stabilisation; startup grace raised so the ~2 min Huawei/Modbus
   reconnect after a restart no longer produces false unavailable→available pairs.
5. **Control path:** a tier-1/tier-2 device unavailable beyond the debounce → alert that
   it cannot be shed during an outage.
6. **Shedding report:** the outage/threshold shed notification distinguishes **shed** /
   **unreachable** / **failed**, and never counts an unreachable device as shed.

Confirmed parameters (operator, 2026-07-20): `N = 3` / `W = 10 min`; `X = 15 min`
(starting value, to be refined from real data during implementation); shedding report
**always** sent (not only on failure). The `X = 15 min` freshness threshold governs only
the **warning** path — it does **not** delay shedding, which stays on the independent
outage path (`OUTAGE_DEBOUNCE_SECONDS = 5 s`).

## 3. Technical Approach

### 3.1 Part 1 — periodic sweep replaces the event-only model (`sensor_health.py`)

The watchdog becomes **actively polling** instead of purely event-driven, because a
frozen sensor fires no events and a poll is the only way to observe "no fresh value".

- Add a periodic tick via `async_track_time_interval(hass, self._sweep, HEALTH_SWEEP)`.
  On each tick, for every source compute three facts:
  - **available** — all its entities' state ∉ {unavailable, unknown} (unchanged helper).
  - **fresh** — `min` over its entities of `getattr(state, "last_reported", None)` is
    within `HEALTH_STALE_SECONDS`. If `last_reported` is missing, treat as **fresh**
    (fail-open) — `last_updated` is **not** used as a fallback, because it only ticks on a
    value/attribute change, so a legitimately-static-but-healthy sensor (a grid enum that
    reads "On-grid" for hours while being polled) would be falsely flagged stale
    (concept-review Blocker 1). `hacs.json` minimum HA is raised to `2024.8.0`, where
    `last_reported` exists.
  - **healthy** = available AND fresh.
- Keep `async_track_state_change_event`, but **only** to record flap edges. An edge is
  appended on a **source-level** `available → unavailable` transition — the handler
  recomputes source availability and compares to the source's prior `available` flag — so a
  single grid loss that drops all three voltage phases at once records **one** edge, not
  three (concept-review Blocker 2). Edges go in a per-source deque pruned to
  `HEALTH_FLAP_WINDOW_SECONDS`. (Polling alone cannot see sub-sweep flaps; the listener
  catches every edge. It no longer arms debounce timers — the sweep decides. The old
  `_reevaluate` / `_debounce` / `_debounce_fired` / `_startup_check` alerting paths are
  **removed**, not kept alongside the sweep, so an episode fires exactly one notification;
  their tests are rewritten for the sweep.)
- Per-source state machine, evaluated in the sweep:
  - unhealthy continuously > `HEALTH_DEBOUNCE_SECONDS` → alert with reason **dead**
    (unavailable) or **stale** (available-but-not-fresh).
  - flap deque length ≥ `HEALTH_FLAP_THRESHOLD` → alert reason **unstable** (once per
    episode).
  - healthy again after an alert → recovery notice; reset the reason + flap deque.
- **Startup grace:** raise `HEALTH_STARTUP_GRACE_SECONDS` 60 → 180 and fold the one-shot
  `_startup_check` into the sweep: while `monotonic() - start < grace`, seed state but do
  not alert. This removes the restart false alarms without a second code path.
- `snapshot()` gains a `reason` field (`healthy` | `dead` | `stale` | `unstable`),
  additively — existing keys unchanged, so the panel keeps working and #57 renders the
  reason later.
- Fail-isolation is preserved: the sweep body is wrapped so a watchdog fault can never
  raise into HA or disturb the automation engine (it shares no locks with it).

### 3.2 Part 2 — control-path health (`sensor_health.py`)

Reuse the same sweep. In addition to the sensor sources, resolve the **tier-1 and tier-2**
label members via `entity_registry.async_entries_for_label` (same call
`services.py:handle_tier_off` uses) and check their availability. A tier device
unavailable > debounce → alert "cannot be shed during an outage", naming the device.

- Scope to tier 1 + tier 2 only: tier 3 is never shed, so "cannot be shed" is meaningless
  for it. `off` is **not** a fault (a device may legitimately be off) — only
  unavailable/unknown counts, which `_is_available` already distinguishes.
- **Mirror `handle_tier_off`'s filter exactly** (concept-review Should 5): apply the same
  `not e.disabled_by` exclusion (services.py:170), and short-circuit the control-path
  check when `resolve_label_id` returns `None` (labels not yet populated) rather than
  treating "no members" as a fault.
- Labels are resolved each sweep via `async_entries_for_label` (an in-memory registry
  scan, cheap at 30 s) so newly labelled/relabelled devices are picked up without a reload.

### 3.3 Part 3 — honest shedding report (`services.py`, `automation_engine.py`)

The outage notification already reports total/failed/duration via
`_format_action_result` (automation_engine.py:738). The gap is that `execute_action`
(state_store.py:148) never checks availability, so a no-op `turn_off` on an unavailable
device is counted as success (false success), and unavailable devices are retried for
~6 s each (`_retry_action`), delaying the shed of the **live** devices.

Decouple **reporting** from **action** so honesty never costs a shed (concept-review):

- In `handle_tier_off` (services.py:149), snapshot each entity's **pre-state** and always
  fire the configured action **once** — including for unavailable/unknown entities (a
  `turn_off` on a still-energised device whose integration merely reports `unavailable`
  must still be attempted; this removes any safety inversion).
- Only the **retries** are gated: retry via `_retry_action` **only** when the pre-state was
  available. An `unavailable`/`unknown` device is attempted once and not retried — which is
  exactly what keeps the live-device shed fast (partial mitigation of the separate
  retry-storm bug for the single-phase case; full parallelisation stays its own ticket).
- Classify from the **pre-state**, not from the call result:
  - pre-state `unavailable`/`unknown` → **unreachable** (BG could not confirm the shed).
  - pre-state available + action succeeded → **shed**.
  - pre-state available + action failed after retries → **failed**.
- Extend `last_action_result` with an `unreachable: list[str]` key (additive; all four
  existing readers use `.get(...)` with defaults).
- Extend `_format_action_result` (automation_engine.py:738): `success_count =
  total − len(failed) − len(unreachable)`, and the `✅` all-good branch requires **both**
  `failed` and `unreachable` empty (else an outage with 2 unreachable + 0 failed would
  still print `✅ 6 devices` — the exact false success AC6 kills, concept-review Should 3).
  New param defaults to `[]` so the `tier_on`/restore callers (:459, :620) stay valid.

### 3.4 New constants (`const.py`)

```
HEALTH_SWEEP_SECONDS = 30            # periodic evaluation cadence
HEALTH_STALE_SECONDS = 900           # 15 min freshness (X) — refine from data
HEALTH_FLAP_WINDOW_SECONDS = 600     # 10 min (W)
HEALTH_FLAP_THRESHOLD = 3            # N dropouts in W
HEALTH_STARTUP_GRACE_SECONDS = 180   # was 60
# HEALTH_DEBOUNCE_SECONDS = 60 stays (sustained-unhealthy before alert)
```

### 3.5 Adversarial concept-review outcome (2026-07-20)

An independent adversarial review checked every code claim against the source (all
`file:line` refs confirmed accurate) and returned **"mature (with fixes)"**. Findings
incorporated above:

- **Blocker 1** — `last_updated` freshness fallback false-positives on static-but-alive
  sensors → fallback is now *fresh*, `getattr` + `hacs.json` min raised to 2024.8.0 (§3.1).
- **Blocker 2** — per-entity flap counting fires a false "unstable" when all 3 voltage
  phases drop together → edges recorded on source-level transitions only (§3.1).
- **Should 3** — formatter success math must subtract `unreachable`; ✅ requires both
  buckets empty (§3.3).
- **Should 4** — do not skip the action on `unknown`; always fire once, gate only retries;
  classify from pre-state (§3.3, fully removes the inversion risk).
- **Should 5** — control-path must replicate the `disabled_by` filter and no-op on missing
  labels (§3.2).
- **Nice** — old event-alert paths must be *removed*, not kept (double-alert); test
  infrastructure (`conftest.MockState`, settable clock) must gain `last_reported` and a
  movable clock before the freshness/flap tests can be written (§7).

### 3.7 Adversarial code-review outcome (2026-07-20)

Two independent adversarial reviews (lens A: correctness/production-safety; lens B: test
quality/domain-semantics) ran against the diff. **No Blocker on correctness** — the shed
fail-open was confirmed safe (an unavailable device is still attempted once; no device
that could be shed is skipped). Findings actioned:

- **Freshness scoped to true sensors** (lens B, production false-alarm risk): the
  battery-optimization `number` entities are actuator-like — Battery Guard writes them and
  their integration may not re-report for >15 min while perfectly healthy. They are now
  watched by **availability only** (`check_freshness=False`); freshness applies to grid /
  voltage / SOC only (§3.1, `_build_sources`).
- **Control-path short-circuit** (lens A): if no tier label resolves, the sweep now returns
  **without pruning** `self._control`, so a transient empty label map cannot wipe alerted
  state (which would drop a recovery notice or fire a duplicate alert).
- **`_handle_change` wrapped** in try/except (lens A) so the fail-isolation invariant holds
  for the one remaining unwrapped periodic entry point.
- **Test coverage added** (lens B Blocker + Shoulds): a full control-path suite (AC5 was
  untested), an end-to-end startup-reconnect-and-recover cycle asserting **zero** alerts
  across the grace boundary (AC4), the unstable-recovery branch, and message-content
  assertions (flap count, freshness minutes, "cannot be shed").

Consciously accepted (documented, no change):

- **Retry drop for an unavailable tier device at shed time** (lens A Should): an entity
  that is `unavailable` at the shed moment is attempted once, not retried. For the actual
  incident (single-phase trip → devices on the dead phase are genuinely de-energised)
  retries are pure waste and the storm-avoidance is the win. A flapping device loses its
  ~6 s retry window, but fail-open still fires the action once. Accepted; revisit only if
  field data shows flapping-at-shed-time missing devices.
- **Time-to-alert stacking**: stale alert ≈ freshness (15 min) + sweep (≤30 s) + debounce
  (60 s); a boot-time-unavailable source alerts ≈ grace (180 s) + debounce (60 s). Both are
  intended and covered by tests.
- **One alert per episode**: a source that degrades from stale to dead keeps its original
  alert (the snapshot `reason` still tracks the current state); no second notification —
  intended to avoid alert spam.

## 4. Security aspects

- The watchdog performs no control actions and shares no locks with the automation engine;
  the sweep is fully fail-isolated (a fault logs and returns, never raises into HA).
- Part 3 touches the safety-critical shed path. The only behavioural change is *skipping
  provably-unavailable devices*; the fail-open guard (§3.3) ensures no shed-able device is
  ever skipped. Secure default = act.

## 5. Data-protection impact (DPIA)

| Criterion | Assessment |
|---|---|
| Personal data | None. Entity IDs and availability flags only; no PII. |
| New storage | None beyond the existing in-memory snapshot. |
| External transfer | None. Notifications go through the operator's own notify services. |
| Result | Not relevant — internal robustness, no personal data. |

## 6. Affected files

- `custom_components/battery_guard/sensor_health.py` — periodic sweep, freshness, flap
  counting, control-path sources, `reason` in snapshot (major).
- `custom_components/battery_guard/const.py` — new constants; grace 60 → 180.
- `custom_components/battery_guard/services.py` — `handle_tier_off` availability
  classification; `unreachable` in `last_action_result`.
- `custom_components/battery_guard/automation_engine.py` — `_format_action_result` shows
  shed/unreachable/failed.
- `tests/` — sweep (dead/stale/unstable), startup grace, control-path, shed
  classification incl. the fail-open guard.
- Version bump in `const.py` + `manifest.json` at `/done` (not now).

## 7. Verification

- Unit tests with a fake clock: frozen sensor (available but `last_reported` old) → stale
  alert; 3 short dropouts in 10 min → unstable alert; sustained unavailable → dead alert;
  recovery resets; no alert inside the 180 s startup grace.
- Shed classification: unavailable device → `unreachable`, not counted as shed, not
  retried; available device that errors → `failed`; available device that switches →
  `shed`; ambiguous → attempted (fail-open).
- Adversarial concept review (this document) before implementation; adversarial code
  review of the diff before `/done` (L-size: multiple lenses — correctness + the shed
  safety inversion).
- Smoke test on the live install: no false alarms in the 180 s after a restart; disabling
  a source entity produces a dead/stale alert after the debounce.

## 8. Acceptance criteria — ✅ all accepted 2026-07-21

1. ✅ **Dead:** source continuously unavailable beyond the threshold → one notification.
   *Live-verified:* Huawei integration disabled 16:57:22 → 4 pushes at ~16:59 (one per
   source, each naming role + entity), i.e. ~90 s = 60 s debounce + sweep granularity.
2. ✅ **Frozen:** no fresh value for > X min while nominally "available" → notification.
   *Covered by tests + adversarial reviews* (freshness scoped to grid/SOC only).
3. ✅ **Flapping:** ≥ N dropouts within window W → one "connection unstable" notification.
   *Covered by tests* incl. the 3-phase single-edge regression.
4. ✅ **No spam / recovery / no startup false alarms** (grace 180 s).
   *Live-verified twice:* no alarms in the first minutes after the HA restart, and no
   premature alert at 45 s into the induced outage (debounce working).
5. ✅ **Control path:** a tier-1/2 device unavailable beyond the threshold → notification
   that it cannot be shed during an outage. *Covered by the TestControlPath suite.*
6. ✅ **Shedding report:** the shed notification distinguishes shed / unreachable /
   failed, with no false success. *Covered by handler + formatter tests.*

**Recovery** additionally live-verified: all 4 sources sent "✅ … is available again"
after the integration was re-enabled — 4 down, 4 up, none swallowed, none duplicated.
