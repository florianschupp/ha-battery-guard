# Concept #70 — Restore only on positively confirmed on-grid

Status: 🚧 **v4** (Phase 1, implemented). Operator decisions: AK 1–6 confirmed 2026-07-22,
**Option A** (strict positive confirmation) chosen after a comparative A-vs-B FMEA.
Issue: #70 (P1, live) · Epic: #52 · groundwork for #49.

> **Revision history.** **v1** rejected: its ON rule was still "absence of an off-grid value",
> and its retry timer shared the `_restore_debounce_handle` slot (orphaned chains).
> **v2** rejected: the once-flag suppressed exactly the notification Option A relies on, and
> AC3 was not deliverable after an HA restart. **v3** fixed both and made the voltage path
> positive as well — which retires the inherited single-phase gap (old F4) as a side effect.
> **v4** corrects v3 after the adversarial code review found two of its design claims to be
> factually wrong (see §2.3, §2.4) and one hazard it had merely documented to be reachable
> through its own new advice (§2.5).

## 1. Goal & Motivation

During a **real outage** the Huawei/Modbus source is most likely to die (SmartGuard islands,
network gear may go down — observed ~13 h on 2026-07-21). When it does,
`binary_sensor._update_from_grid_state` collapses `unavailable` → `_attr_is_on = False`
(binary_sensor.py:125-129; the voltage variant maps an unavailable phase to normal voltage,
:213-218). The engine listens to that **binary sensor**, not the raw source
(automation_engine.py:76-84), so it sees a clean, honest-looking **`on → off` edge** —
indistinguishable from a real grid return. `_handle_power_outage_change:223` starts the restore
debounce and 30 s later `restore_all` re-energises every shed load **on the island battery**,
while the operator receives "✅ Grid Power Restored". **Live today, not latent.**

The collapse is **correct as an entry rule** (a comms loss must never cause shedding — #51A) and
**dangerous as an exit rule**, where it means "switch everything back on".

## 2. Technical Approach

**Principle: restoring requires a *positive* confirmation — a recognised on-grid reading — not
merely the absence of an off-grid one.**

### 2.1 3-state classification (pure, `grid_status.py`)

```
GRID_ON / GRID_OFF / GRID_UNKNOWN

GRID_ON_STATES = {"on-grid", "on_grid", "ongrid", "on grid", "grid connected"}

classify_grid_status(raw):
    None | "" | "unavailable" | "unknown"   -> UNKNOWN
    state_indicates_outage(raw)             -> OFF       # existing allow-list, untouched
    normalized in GRID_ON_STATES            -> ON
    anything else                           -> UNKNOWN   # ← Option A
```

**Voltage variant — now positive as well (changed in v3):**

```
classify_grid_voltage(raw_phases, threshold):
    empty list                                     -> UNKNOWN   # avoids the all([]) vacuum truth
    any phase missing / unavailable / non-numeric  -> UNKNOWN
    ALL phases below threshold                     -> OFF
    ALL phases above threshold                     -> ON
    mixed (some above, some below)                 -> UNKNOWN
```

v2 defined ON as "at least one above" — i.e. `not(all below)`, which is the same
absence-of-negative rule that got v1 rejected, just in the other path. Requiring **all** phases
above makes the rule positive **and retires the inherited single-phase gap**: with one phase
dead the result is UNKNOWN, so no restore is permitted. (Detection is unaffected — this function
is used only by the restore gate, never by the binary sensor. #67 still owns the *detection*
side of the same defect.)

**Deliberately excluded from `GRID_ON_STATES`: a bare `"on"`.** Correcting v2's rationale, which
cited the wrong entity: the configured grid source may per `config_flow.py:249-253` be a
`sensor`, `binary_sensor` **or** `input_boolean`, where `"on"`/`"off"` are the only values —
and there `"on"` is as likely to mean *outage present* as *grid present*. Admitting it could
invert the meaning. **Consequence, stated plainly:** with a `binary_sensor`/`input_boolean`
source, `_grid_state()` is always UNKNOWN and the automatic restore never runs. Note that
**detection is already dead for those domains today** (`"on"`/`"off"` are not in
`GRID_OFF_STATES`), so the selector is a pre-existing trap → **separate follow-up ticket**, not
widened here.

`VOLTAGE_OUTAGE_THRESHOLD` moves from `binary_sensor.py:32` to `const.py` (pure move; verified
no import cycle — `const.py` imports nothing from the package, `grid_status.py` stays HA-free by
taking the threshold as a parameter).

### 2.2 The gate in `_on_grid_restored`

Verified as the **only automatic** caller of `restore_all` (automation_engine.py:441). The engine
gains `_grid_state()`; `_on_grid_restored` consults it **after** the existing `active`-switch
check (:435):

- **ON** → proceed exactly as today.
- **OFF** → outage genuinely still running → log warning, return.
- **UNKNOWN** → return without restoring, and notify (see §2.4).

The gate re-evaluates `_grid_state()` **at the moment the debounce fires**, not when it was
armed. A transient on-grid reading that disappears within the 30 s window is therefore rejected
at fire time — this is what contains the startup-transient risk without a separate grace timer.

### 2.3 Raw-source listener + one initial evaluation (replaces v1's timer)

The hole: if the source returns *already reading* `On-grid`, the binary sensor is already `off`,
no transition occurs, and `_on_grid_restored` is never called again.

**(a) Listener.** `async_start` registers `async_track_state_change_event` on the configured raw
source(s) — the grid sensor, or **all three** phase entities for the voltage variant, with
empty/unset entity_ids filtered out first (same pattern as `sensor_health.py:115-133`). The
unsubscribe **must** be appended to `self._unsub_listeners` (automation_engine.py:58) so the
teardown loop at :136-138 removes it. *(v2 wrongly claimed "nothing new to tear down" — an
unregistered listener would survive `async_reload` (config_flow.py:366) and let a dead engine
arm a restore.)*

In voltage mode the three phase entities are **all-or-nothing**: an incomplete config yields no
sources at all, hence UNKNOWN. Otherwise two configured phases could authorise a restore while
the third is unknown.

```
_evaluate_grid_source():
    if within the startup grace:                  return   # see (b)
    if self._restore_debounce_handle is not None: return   # a restore is already pending
    if self._restore_in_progress:                 return   # restore_all is running
    if not self._emergency_active():              return   # cached lookup, see below
    grid = self._grid_state()
    if grid == GRID_UNKNOWN:  self._notify_restore_suspended(); return   # §2.4
    if grid == GRID_OFF:                          return   # ongoing outage, not news
    arm the restore debounce (RESTORE_DEBOUNCE_SECONDS)
```

**(b) Startup grace + one evaluation — corrected in v4.** A listener only fires on *change*.
After an HA restart during an active episode the source may already read `On-grid` and never
change again → devices would stay shed indefinitely. So one evaluation must run unprompted.

v3 specified `EVENT_HOMEASSISTANT_STARTED`, "or immediately if `hass.is_running`", and claimed
`_ha_started` provided the ~2 min Modbus grace. **Both claims were false**, as the adversarial
code review demonstrated:

1. `HomeAssistant.is_running` is `state in (CoreState.starting, CoreState.running)` — it is
   already `True` during boot-time `async_setup_entry`. The `else` branch registering the event
   listener was therefore unreachable in the normal boot path, and the evaluation ran *inside
   setup*.
2. Even when it does fire, `EVENT_HOMEASSISTANT_STARTED` arrives within **seconds** of setup —
   not after 180 s. There was no grace at any point.

Net effect of v3-as-specified: HA reboots mid-outage, `huawei_solar` serves a stale `On-grid`,
the debounce arms, the fire-time re-check reads the *same* stale value, and `restore_all` puts
the full house load back onto the island battery — announcing it as "✅ Grid Power Restored".
That is F1, reintroduced through the boot path this ticket added.

**v4 replaces the event with an elapsed-time grace:** `async_start` records
`_grace_expires_at = monotonic() + RESTORE_STARTUP_GRACE_SECONDS` (180 s) and arms an
`async_call_later` for the same delay. `_evaluate_grid_source` returns early while the deadline
is in the future; the timer performs the unprompted evaluation once it passes. This is strictly
simpler than v3 — no `EVENT_HOMEASSISTANT_STARTED`, no `async_listen_once` unsubscribe to track
(which v3 would have double-called in `async_stop`, logging a traceback on every reload) — and it
is the only variant that actually delivers the grace the FMEA assumed.

**Arm-if-idle, never cancel-and-re-arm.** In the voltage variant three numeric sensors fire on
every poll; cancel-and-re-arm would reset the 30 s window continuously and the restore would
**never** fire. The binary-sensor path keeps its cancel-and-re-arm semantics — there a fresh
transition *should* restart the stability window. Cancellation on a renewed outage is unchanged
(`_handle_power_outage_change:208-211` cancels whichever path armed the handle).

**Cost.** `_get_switch_state` → `_find_entity` scans the whole entity registry
(automation_engine.py:142-158). With three voltage sensors polling, that would run constantly.
The `active` entity_id is therefore **resolved once and cached** (`_emergency_active()`). v4 adds:
when the cached id has no state, re-resolve instead of returning `False`. A cached-but-stale id
(the operator renames the switch in the HA UI — no reload occurs on a rename) would otherwise
report "no emergency" forever, silently disabling this entire catch-up path with no log line.

### 2.4 Suspension notice — keyed on the CAUSE, not the reading (corrected in v4)

v2 used a one-shot bool. That destroys the mitigation Option A depends on: source dies →
"unavailable" notice + flag set → source returns with an **unrecognised** value → silent return,
and the operator never learns *which value* is blocking them.

v3 therefore keyed the dedupe on the **displayed raw value** — which is correct for a status
source but catastrophic for the voltage path: the displayed value there contains three live
floats that change on every poll, so every poll is a "new" blocking value. The code review
reproduced it: **10 polls → 10 pushes**. A Shelly 3EM reports ~1/s, so a multi-hour single-phase
outage would bury the `critical: True` low-battery alarm under thousands of notifications — on
battery power, in exactly the degradation regime this ticket exists for.

**v4 keys on a classification signature** (`_suspension_cause()`): per source, a token of
`missing` / `unavailable` / `unknown` / `empty` / the normalized status string / — in voltage
mode — the *bucket* `above`|`below`|`not-a-number`. Live numbers never enter the key; they appear
only in the message body. Two layers:

1. same cause → never repeated within one emergency episode;
2. changed cause → repeated, but never more often than `RESTORE_SUSPENDED_RENOTIFY_SECONDS`
   (15 min). When rate-limited, the cause is deliberately **not** stored, so it is delivered when
   the window opens rather than lost.

Both are reset in `_handle_active_change` on a genuine `STATE_OFF` (mirroring `_critical_alerted`).

The message stays the actionable one — it names the raw value, turning F2 into a one-line
allow-list fix. In `_on_grid_restored` the notification is **awaited** (`blocking=True`) rather
than fire-and-forget: it is the only signal the operator gets, and a dropped task would make the
suspension as silent as the bug it replaces.

### 2.5 Deliberately NOT in scope

- The binary sensor is **not** changed (AC5).
- `_handle_power_outage_change:199-203`, the `new_state` guard, the `_outage_start_time` latch,
  the full reboot reconciliation: all stay in #49/#62. **This ticket is the signal, not the
  lifecycle.** (§2.3(b) is a single evaluation, not a reconciliation state machine.)
- `restore_all` stays callable as a service (services.yaml:29) and from the panel → AC1/AC2 are
  scoped to the **automatic, engine-triggered** restore.
- Widening the grid-source selector / supporting `binary_sensor` sources → follow-up ticket.

**⚠️ One item moved OUT of "not in scope" in v4.** v3 documented as a known hazard that ending an
emergency by hand strands `_outage_start_time`, so `_on_power_outage` silently skips the *next*
outage (#62) — no shed, no notification, nothing above DEBUG. That was defensible while
`restore_all` was an unusual manual act. It stopped being defensible the moment this ticket made
`restore_all` **the documented escape hatch** for a suspended restore: the change raises the
likelihood of a *gravierend + silent* failure, which the failure-effects gate calls a re-design
trigger, not an acceptable residual risk.

v4 therefore clears `_outage_start_time` in `_handle_active_change` on a genuine `STATE_OFF` —
alongside `_critical_alerted` and the suspension state, all of which mean the same thing: the
emergency is over. `_on_grid_restored` reads the start time into a local **before** calling
`restore_all`, because that call turns the switch off and the resulting state event now clears the
field while the coroutine is still awaiting. The broader reboot reconciliation stays in #49/#62.

## 3. Security aspects

No new surface. Strictly fail-safe: the unknown case performs **no** action.

## 4. Data-protection impact (DPIA)

No personal data, no new storage, no external transfer — not relevant.

## 5. Failure-effects gate (FMEA)

| # | Failure mode | Severity | Detected? | Guard |
|---|---|---|---|---|
| F1 | *(the bug)* comms loss mid-outage → everything switched back on | **severe** | **inverted** today | §2.1/§2.2 positive confirmation |
| F2 | Valid on-grid value not on the allow-list → automatic restore never runs | noticeable | **notice naming the raw value** (§2.4) | widen allow-list; manual `restore_all` |
| F3 | Other installations report different values → they never auto-restore | noticeable | notice | **verify real sensor values at all 3 sites before rollout** — v4 makes this discoverable *outside this file*: USER_GUIDE.md now carries a "check Developer Tools → States" warning, and its `Gerätestatus` claim is corrected (its compound on-grid values have no ON counterpart) |
| F4 | **Frozen source stuck on an off-grid value** → `_grid_state()` = OFF forever, no events, restore never runs — and the OFF branch is silent | noticeable→severe | via **#56 stale detection** (`sensor_health.py`), not via this gate | rely on #56's stale alarm; do not add a second detector |
| F5 | Sensor lies (reports on-grid while off-grid) | severe | no | out of scope for both options — needs an independent source (#59) |
| F6 | `binary_sensor`/`input_boolean` configured as grid source → always UNKNOWN → never restores (detection already dead there today) | noticeable | notice (§2.4) | follow-up ticket for the selector |
| F7 | *(v4, found by review)* HA restarts mid-outage, Modbus still reconnecting → stale `On-grid` → restore onto the island battery, reported as success | **severe** | **no — the signature is a ✅ notification** | 180 s startup grace (§2.3b) |
| F8 | *(v4, found by review)* suspension notice keyed on a live reading → one push per poll, burying the critical-SOC alarm | noticeable→severe *(it disables the channel the other guards rely on)* | yes, painfully | cause-signature key + 15 min floor (§2.4) |
| F9 | *(v4, found by review)* manual `restore_all` — now the documented escape hatch — strands `_outage_start_time`, so the NEXT outage is skipped entirely | **severe** | **no** (nothing above DEBUG) | clear the latch on genuine `active`→OFF (§2.5) |

Residual risks: F2/F3/F6 **accepted** — the deliberate A-vs-B trade (severe+silent →
noticeable+visible). F4 accepted **because #56 already detects it**. F5 out of scope.
F7/F8/F9 **closed in v4**, not accepted: each was severe, and F7/F9 were also silent — the
combination the failure-effects gate names as a re-design trigger rather than a residual risk.

> **Process note.** All three were introduced *by this ticket's own mitigation* and all three
> passed the implementer's tests. They were found only by the independent adversarial review —
> which is exactly the case the review gate exists for. F7 in particular was invisible to every
> behavioural test because nothing exercised `async_start`.

## 6. Affected files

**Implemented in:**

| File | Change |
|---|---|
| `grid_status.py` | 3-state classification (`classify_grid_status`, `classify_grid_voltage`, `GRID_ON/OFF/UNKNOWN`) |
| `const.py` | `VOLTAGE_OUTAGE_THRESHOLD` (moved), `RESTORE_STARTUP_GRACE_SECONDS`, `RESTORE_SUSPENDED_RENOTIFY_SECONDS` |
| `binary_sensor.py` | one import line — detection logic untouched (AC5) |
| `automation_engine.py` | `_raw_grid_sources`, `_grid_state`, `_raw_grid_values`, `_suspension_cause`, `_emergency_active`, `_claim_suspension_notice`, `_notify_restore_suspended`, `_startup_grace_expired`, `_evaluate_grid_source`, `_handle_grid_source_change`; gate in `_on_grid_restored`; `async_start`/`async_stop` wiring; latch resets in `_handle_active_change` |
| `tests/conftest.py` | `CONF_GRID_SENSOR`/`CONF_USE_VOLTAGE` in `mock_entry.data`, `GRID_SENSOR_ENTITY` |
| `tests/test_grid_confirmation.py` | new — classification, gate, suspension, wiring, voltage path |
| `tests/test_automation_engine.py` | two restore tests now state the grid explicitly |
| `docs/USER_GUIDE.md` | "when is the grid back", `Gerätestatus` correction, per-installation check warning |
| `docs/SCENARIOS.md` | S6/S10 precision, new S13, L1 + L6 corrected |

## 7. Verification — and its honest limits

**Agent-verified:** the pure classification (both variants, all outcomes incl. mixed, empty and
the exact threshold); the gate — *is `restore_all` called or not* for ON/OFF/UNKNOWN; that the
suspension notice is deduped **by cause** and rate-limited, and that a voltage source polling with
changing floats produces exactly one notice; that `async_start` registers the raw-source listener,
collects its unsubscribe, and arms the grace **without evaluating anything**; that `async_stop`
cancels the grace timer and all listeners; the voltage path end-to-end through `_grid_state()`;
that `active`→OFF clears the outage re-entry latch while a flickering switch entity does not.

**NOT agent-verifiable here:**

- **That an armed debounce actually fires over time.** `async_call_later` is mocked
  (tests/conftest.py). Tests assert that arming was *requested*, never the timing. The same
  applies to the 180 s grace: the deadline arithmetic is tested, the real timer is not.
- **The real Huawei value at each of the three installations.** This is F3, and no test can
  answer it — it needs Developer Tools → States at each site. **Blocking for rollout, not for
  staging.**
- **Whether the mocked `homeassistant` package behaves like the real one.** This is precisely how
  F7 slipped through v3: `hass.is_running` was mocked and its real semantics were never in play.
  The grace redesign removes the dependency, but the general limitation stands.
- **That the notification actually reaches the phone.** Delivery has failed before in this project
  (#56); the tests assert the service call, not the push.

**Field check (staging, Florian's HA):** during an active emergency pull the Huawei integration →
no restore, and the suspension notice must arrive naming the raw value; re-enable → restore runs.
Second check: restart HA during an active emergency → nothing happens for 3 min, then one
evaluation.

## 8. Acceptance criteria

*AK 1–6 confirmed 2026-07-22 (AC2/AC3/AC4 in their sharpened form). Wording unchanged in v4 —
the review findings changed the implementation, not the promises.*

1. **No automatic restore while the grid state is unknown** — even when the outage sensor reports
   "no outage".
2. **Automatic restore only on positively confirmed on-grid** — a recognised on-grid value, or
   (voltage variant) **all** phases available, numeric and above threshold.
3. **No permanent block** — the restore also runs when the source returns *without* producing a
   binary-sensor transition, **including across an HA restart** (raw listener + one evaluation
   after the startup grace).
4. **Visibility** — a suspended restore is reported once **per distinct blocking cause** and the
   notice **names the raw value**. *(v4: "cause", not "value" — see §2.4. A voltage reading that
   changes on every poll is the same cause, otherwise AC4 delivers a notification storm instead
   of visibility.)*
5. **No detection regression** — the binary sensor is unchanged; "comms loss is never off-grid"
   still holds; off-grid classification untouched.
6. **Both configurations** — grid-status sensor *and* voltage variant, both under the positive
   rule.
