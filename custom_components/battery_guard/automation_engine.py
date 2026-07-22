"""Automation engine for Battery Guard.

Replaces 6 YAML automations with Python event listeners:
1. Power outage → tier 1 off + notify
2. SOC below threshold → tier 2 off + notify
3. Grid restored → restore all + notify
4. SOC recovered → tier 2 on + notify
5. Critical SOC → critical notify
6. Unassigned count increase → notify
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    STATE_OFF,
    STATE_ON,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
)

from .const import (
    CONF_BATTERY_OPTIMIZATION,
    CONF_CRITICAL_SOC,
    CONF_GRID_SENSOR,
    CONF_SOC_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DEFAULT_BATTERY_OPTIMIZATION,
    DEFAULT_CRITICAL_SOC,
    DOMAIN,
    LABEL_TIER1,
    LABEL_TIER2,
    LABEL_TIER3,
    OUTAGE_DEBOUNCE_SECONDS,
    RESTORE_DEBOUNCE_SECONDS,
    RESTORE_STARTUP_GRACE_SECONDS,
    RESTORE_SUSPENDED_RENOTIFY_SECONDS,
    VOLTAGE_OUTAGE_THRESHOLD,
)
from .grid_status import (
    GRID_OFF,
    GRID_ON,
    GRID_UNKNOWN,
    classify_grid_status,
    classify_grid_voltage,
)
from .labels import resolve_label_id

_LOGGER = logging.getLogger(__name__)


class BatteryGuardAutomationEngine:
    """Core automation engine replacing YAML automations."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the automation engine."""
        self.hass = hass
        self.entry = entry
        self._unsub_listeners: list[CALLBACK_TYPE] = []
        self._soc_sensor: str = entry.data.get(CONF_SOC_SENSOR, "")
        self._critical_soc: float = entry.data.get(
            CONF_CRITICAL_SOC, DEFAULT_CRITICAL_SOC
        )
        self._outage_debounce_handle: CALLBACK_TYPE | None = None
        self._restore_debounce_handle: CALLBACK_TYPE | None = None
        self._outage_start_time: float | None = None
        self._operation_lock = asyncio.Lock()
        # Guards against duplicate critical-SOC alarms within one emergency;
        # reset when the 'active' switch turns off (see _handle_active_change).
        self._critical_alerted: bool = False
        # #70: the CAUSE we last reported as blocking a restore. Keyed on the
        # classification signature, never on the displayed reading: in voltage
        # mode the reading contains live floats that change on every poll, which
        # would turn "one notice per cause" into one push per second.
        self._restore_suspended_cause: tuple[str, ...] | None = None
        self._restore_suspended_notified_at: float | None = None
        # Resolved lazily, re-resolved when it goes stale (an entity rename would
        # otherwise silently kill the catch-up path).
        self._active_entity_id: str | None = None
        # Raw-source evaluation is suppressed until this monotonic deadline —
        # see RESTORE_STARTUP_GRACE_SECONDS.
        self._grace_expires_at: float | None = None
        self._grace_handle: CALLBACK_TYPE | None = None
        # Guards the window between restore_all and the end of _on_grid_restored.
        self._restore_in_progress: bool = False

    async def async_start(self) -> None:
        """Start all event listeners."""
        _LOGGER.info("Starting Battery Guard automation engine")

        # Find our power outage binary sensor entity
        outage_entity = self._find_entity("power_outage")
        if outage_entity:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self.hass,
                    [outage_entity],
                    self._handle_power_outage_change,
                )
            )
            _LOGGER.debug("Listening to power outage: %s", outage_entity)
        else:
            _LOGGER.warning(
                "Power outage entity not found — outage automation disabled"
            )

        # Listen to SOC sensor for threshold/recovery/critical events
        if self._soc_sensor:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self.hass,
                    [self._soc_sensor],
                    self._handle_soc_change,
                )
            )
            _LOGGER.debug("Listening to SOC sensor: %s", self._soc_sensor)

        # Listen to unassigned devices sensor
        unassigned_entity = self._find_entity("unassigned_devices")
        if unassigned_entity:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self.hass,
                    [unassigned_entity],
                    self._handle_unassigned_change,
                )
            )
            _LOGGER.debug("Listening to unassigned devices: %s", unassigned_entity)

        # Listen to the emergency 'active' switch to re-arm the critical alarm
        # whenever emergency mode ends (covers the grid-restored event AND a
        # manual restore_all, which both turn this switch off).
        active_entity = self._find_entity("active")
        self._active_entity_id = active_entity
        if active_entity:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self.hass,
                    [active_entity],
                    self._handle_active_change,
                )
            )

        # #70: listen to the RAW grid source(s), not only to our own binary
        # sensor. If the source comes back already reading on-grid, the binary
        # sensor never transitions (it is already `off`) and the restore path
        # would never run — devices would stay shed indefinitely.
        raw_sources = self._raw_grid_sources()
        if raw_sources:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self.hass,
                    raw_sources,
                    self._handle_grid_source_change,
                )
            )
            _LOGGER.debug("Listening to raw grid source(s): %s", raw_sources)
        else:
            _LOGGER.warning(
                "No raw grid source configured — automatic restore is disabled "
                "(a restore then requires the restore_all service)"
            )

        # Startup grace, then exactly one evaluation. The timer is what covers an
        # outage that ended while HA was down: the source then comes back ALREADY
        # reading on-grid, so no state change will ever arrive to trigger us.
        # Waiting out the grace first is what keeps a stale Modbus value from
        # restoring every shed load onto the island battery.
        self._grace_expires_at = time.monotonic() + RESTORE_STARTUP_GRACE_SECONDS
        self._grace_handle = async_call_later(
            self.hass, RESTORE_STARTUP_GRACE_SECONDS, self._startup_grace_expired
        )

    async def async_stop(self) -> None:
        """Stop all event listeners and cancel pending debounce timers."""
        _LOGGER.info("Stopping Battery Guard automation engine")
        if self._outage_debounce_handle:
            self._outage_debounce_handle()
            self._outage_debounce_handle = None
        if self._restore_debounce_handle:
            self._restore_debounce_handle()
            self._restore_debounce_handle = None
        if self._grace_handle:
            self._grace_handle()
            self._grace_handle = None
        for unsub in self._unsub_listeners:
            unsub()
        self._unsub_listeners.clear()

    def _find_entity(self, key_suffix: str) -> str | None:
        """Find a Battery Guard entity by unique_id suffix."""
        registry = er.async_get(self.hass)
        for entity in registry.entities.values():
            if (
                entity.platform == DOMAIN
                and entity.unique_id
                and entity.unique_id.endswith(f"_{key_suffix}")
            ):
                return entity.entity_id
        return None

    def _get_switch_state(self, key_suffix: str) -> bool:
        """Get the current state of a Battery Guard switch."""
        entity_id = self._find_entity(key_suffix)
        if not entity_id:
            return False
        state = self.hass.states.get(entity_id)
        return state is not None and state.state == STATE_ON

    def _get_threshold(self, key_suffix: str) -> float | None:
        """Get the current value of a Battery Guard number entity."""
        entity_id = self._find_entity(key_suffix)
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return None
        try:
            return float(state.state)
        except (ValueError, TypeError):
            return None

    @callback
    def _handle_active_change(self, event: Event) -> None:
        """Reset per-emergency guards when emergency mode ends.

        Only a genuine OFF transition counts — a transient `unavailable`/
        `unknown` of the switch must NOT re-arm mid-emergency (would allow
        duplicate critical alarms).
        """
        new_state = event.data.get("new_state")
        if new_state is not None and new_state.state == STATE_OFF:
            self._critical_alerted = False
            self._restore_suspended_cause = None
            self._restore_suspended_notified_at = None
            # The emergency is over by every definition the engine has — clear the
            # re-entry guard too. Without this, a MANUAL restore_all (the documented
            # escape hatch when a restore is suspended) leaves _outage_start_time
            # set, and _on_power_outage then silently skips the NEXT real outage:
            # no tier-1 shed, no notification, nothing above DEBUG in the log.
            self._outage_start_time = None

    # =========================================================================
    # #70: positively confirmed on-grid before any automatic restore
    # =========================================================================
    def _raw_grid_sources(self) -> list[str]:
        """The configured RAW grid source entity_ids.

        In voltage mode this is all-or-nothing: with a phase missing from the
        config, a restore could be authorised from two phases while the third is
        unknown. An incomplete config yields no sources, hence UNKNOWN, hence no
        automatic restore.
        """
        data = self.entry.data
        if data.get(CONF_USE_VOLTAGE, False):
            keys = (CONF_VOLTAGE_PHASE_A, CONF_VOLTAGE_PHASE_B, CONF_VOLTAGE_PHASE_C)
            phases = [data.get(key, "") for key in keys]
            return phases if all(phases) else []
        grid = data.get(CONF_GRID_SENSOR, "")
        return [grid] if grid else []

    def _grid_state(self) -> str:
        """Derive a real 3-state grid signal from the RAW source(s).

        The binary sensor cannot answer this: it collapses `unavailable` to
        "no outage" (correct for detection — a comms loss must never shed —
        but it would mean "switch everything back on" here). So the engine
        reads the raw source itself. The binary sensor stays untouched.
        """
        raws: list[str | None] = []
        for entity_id in self._raw_grid_sources():
            state = self.hass.states.get(entity_id)
            raws.append(state.state if state is not None else None)

        if self.entry.data.get(CONF_USE_VOLTAGE, False):
            return classify_grid_voltage(raws, VOLTAGE_OUTAGE_THRESHOLD)
        if not raws:
            return GRID_UNKNOWN
        return classify_grid_status(raws[0])

    def _raw_grid_values(self) -> str:
        """Human-readable raw source value(s) for the suspension notice."""
        parts: list[str] = []
        for entity_id in self._raw_grid_sources():
            state = self.hass.states.get(entity_id)
            parts.append(state.state if state is not None else "entity not found")
        return " / ".join(parts) if parts else "no grid source configured"

    def _suspension_cause(self) -> tuple[str, ...]:
        """A stable identity for WHY the restore is blocked.

        Must not contain live readings. In voltage mode the displayed value
        carries three floats that change on every poll — deduplicating on those
        would send one push per measurement, drowning the alert channel that also
        carries the critical-SOC alarm.
        """
        sources = self._raw_grid_sources()
        if not sources:
            return ("unconfigured",)

        voltage_mode = self.entry.data.get(CONF_USE_VOLTAGE, False)
        tokens: list[str] = []
        for entity_id in sources:
            state = self.hass.states.get(entity_id)
            if state is None:
                tokens.append(f"{entity_id}=missing")
                continue
            normalized = state.state.strip().lower()
            if normalized in ("", STATE_UNAVAILABLE, STATE_UNKNOWN):
                tokens.append(f"{entity_id}={normalized or 'empty'}")
            elif voltage_mode:
                # Bucket the reading, never the number itself.
                try:
                    volts = float(normalized)
                except (ValueError, TypeError):
                    tokens.append(f"{entity_id}=not-a-number")
                else:
                    below = volts < VOLTAGE_OUTAGE_THRESHOLD
                    tokens.append(f"{entity_id}={'below' if below else 'above'}")
            else:
                # A status source's distinct strings ARE distinct causes.
                tokens.append(f"{entity_id}={normalized}")
        return tuple(tokens)

    def _emergency_active(self) -> bool:
        """Is emergency mode on? Caches the entity_id (hot path, see listener)."""
        if not self._active_entity_id:
            self._active_entity_id = self._find_entity("active")
        if not self._active_entity_id:
            return False
        state = self.hass.states.get(self._active_entity_id)
        if state is None:
            # Stale cache (entity renamed) — re-resolve rather than silently
            # reporting "no emergency", which would kill the catch-up path.
            self._active_entity_id = self._find_entity("active")
            if not self._active_entity_id:
                return False
            state = self.hass.states.get(self._active_entity_id)
        return state is not None and state.state == STATE_ON

    def _claim_suspension_notice(self) -> str | None:
        """Return the message to send, or None if this cause was already reported.

        Two layers: same cause → never repeat within one emergency; changed cause
        → repeat, but never more often than RESTORE_SUSPENDED_RENOTIFY_SECONDS.
        """
        cause = self._suspension_cause()
        raw = self._raw_grid_values()
        if cause == self._restore_suspended_cause:
            _LOGGER.debug("Restore still suspended (%s)", raw)
            return None

        now = time.monotonic()
        last = self._restore_suspended_notified_at
        if last is not None and now - last < RESTORE_SUSPENDED_RENOTIFY_SECONDS:
            # Deliberately do NOT store the cause: it stays un-reported and will
            # be sent once the window opens, instead of being lost.
            _LOGGER.debug("Restore suspension cause changed (%s) — rate limited", raw)
            return None

        self._restore_suspended_cause = cause
        self._restore_suspended_notified_at = now
        _LOGGER.warning("Restore suspended — grid state not confirmed (%s)", raw)
        return (
            f"Grid state could not be confirmed (source reports: {raw}). "
            "Devices stay shed until a confirmed on-grid reading arrives."
        )

    @staticmethod
    def _suspension_payload(message: str) -> dict[str, Any]:
        return {
            "title": "⏸️ Battery Guard: restore suspended",
            "message": message,
            "critical": False,
        }

    @callback
    def _notify_restore_suspended(self) -> None:
        """Fire-and-forget variant for the synchronous listener path."""
        message = self._claim_suspension_notice()
        if message is None:
            return
        self.hass.async_create_task(
            self.hass.services.async_call(
                DOMAIN, "notify", self._suspension_payload(message), blocking=False
            )
        )

    @callback
    def _startup_grace_expired(self, _now: Any) -> None:
        """Startup grace is over — the raw source is now trustworthy."""
        self._grace_handle = None
        self._grace_expires_at = None
        self._evaluate_grid_source()

    @callback
    def _handle_grid_source_change(self, _event: Event) -> None:
        """Raw grid source changed — may need to catch up on a missed restore."""
        self._evaluate_grid_source()

    @callback
    def _evaluate_grid_source(self) -> None:
        """Arm the restore check when the raw source positively confirms on-grid.

        Needed because a source that returns *already reading* on-grid produces
        NO binary-sensor transition (the sensor is already `off`), so the normal
        restore path would never run and devices would stay shed forever.
        """
        if self._grace_expires_at is not None:
            if time.monotonic() < self._grace_expires_at:
                return
            self._grace_expires_at = None
        # Cheap first: a restore is already pending — arm-if-idle, never
        # cancel-and-re-arm (three polling voltage sensors would otherwise reset
        # the stability window forever and the restore would never fire).
        if self._restore_debounce_handle is not None or self._restore_in_progress:
            return
        if not self._emergency_active():
            return

        grid = self._grid_state()
        if grid == GRID_UNKNOWN:
            self._notify_restore_suspended()
            return
        if grid == GRID_OFF:
            return  # genuine ongoing outage — nothing to report

        _LOGGER.info(
            "Raw grid source confirms on-grid — waiting %ds before restore",
            RESTORE_DEBOUNCE_SECONDS,
        )
        self._restore_debounce_handle = async_call_later(
            self.hass, RESTORE_DEBOUNCE_SECONDS, self._restore_debounce_fired
        )

    # =========================================================================
    # 1 & 3: Power Outage / Grid Restored
    # =========================================================================
    @callback
    def _handle_power_outage_change(self, event: Event) -> None:
        """Handle power outage sensor state change with debounce.

        Outage must persist for OUTAGE_DEBOUNCE_SECONDS before action.
        Grid must be stable for RESTORE_DEBOUNCE_SECONDS before restore.
        This prevents unnecessary shutdowns from grid flicker.
        """
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")

        if new_state is None:
            return

        # Skip initial state or unavailable transitions
        if old_state is None or old_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return

        if new_state.state == STATE_ON and old_state.state != STATE_ON:
            # Power outage detected — cancel pending restore, start outage debounce
            if self._restore_debounce_handle:
                self._restore_debounce_handle()
                self._restore_debounce_handle = None
                _LOGGER.debug("Cancelled pending restore (grid lost again)")
            if self._outage_debounce_handle:
                self._outage_debounce_handle()
            _LOGGER.info(
                "Power outage detected — waiting %ds to confirm",
                OUTAGE_DEBOUNCE_SECONDS,
            )
            self._outage_debounce_handle = async_call_later(
                self.hass,
                OUTAGE_DEBOUNCE_SECONDS,
                self._outage_debounce_fired,
            )
        elif new_state.state != STATE_ON and old_state.state == STATE_ON:
            # Grid restored — cancel pending outage, start restore debounce
            if self._outage_debounce_handle:
                self._outage_debounce_handle()
                self._outage_debounce_handle = None
                _LOGGER.info(
                    "Grid flicker detected — outage cancelled (< %ds)",
                    OUTAGE_DEBOUNCE_SECONDS,
                )
            if self._restore_debounce_handle:
                self._restore_debounce_handle()
            _LOGGER.info(
                "Grid restored — waiting %ds to confirm stability",
                RESTORE_DEBOUNCE_SECONDS,
            )
            self._restore_debounce_handle = async_call_later(
                self.hass,
                RESTORE_DEBOUNCE_SECONDS,
                self._restore_debounce_fired,
            )

    @callback
    def _outage_debounce_fired(self, _now: Any) -> None:
        """Called after outage debounce timer expires."""
        self._outage_debounce_handle = None
        self.hass.async_create_task(self._on_power_outage())

    @callback
    def _restore_debounce_fired(self, _now: Any) -> None:
        """Called after restore debounce timer expires."""
        self._restore_debounce_handle = None
        self.hass.async_create_task(self._on_grid_restored())

    async def _apply_battery_optimization(self, mode: str) -> None:
        """Apply battery optimization values.

        Args:
            mode: "outage" to set outage values, "normal" to restore normal values.
        """
        config = self.entry.data.get(
            CONF_BATTERY_OPTIMIZATION, DEFAULT_BATTERY_OPTIMIZATION
        )
        if not config.get("enabled", False):
            return

        entities = config.get("entities", [])
        for entity_cfg in entities:
            entity_id = entity_cfg.get("entity_id")
            if not entity_id:
                continue

            value = entity_cfg.get(f"{mode}_value")
            if value is None:
                continue

            state = self.hass.states.get(entity_id)
            if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                _LOGGER.warning(
                    "Battery optimization: %s unavailable, skipping", entity_id
                )
                continue

            value_f = float(value)
            min_val = state.attributes.get("min")
            max_val = state.attributes.get("max")
            if (
                min_val is not None
                and max_val is not None
                and (value_f < min_val or value_f > max_val)
            ):
                _LOGGER.warning(
                    "Battery optimization: skipped %s — %s value %s "
                    "out of range [%s, %s]",
                    entity_id,
                    mode,
                    value_f,
                    min_val,
                    max_val,
                )
                await self._notify_out_of_range(
                    entity_id, mode, value_f, min_val, max_val
                )
                continue

            try:
                await self.hass.services.async_call(
                    "number",
                    "set_value",
                    {"value": value_f},
                    target={"entity_id": entity_id},
                    blocking=True,
                )
                _LOGGER.info(
                    "Battery optimization: set %s to %s (%s mode)",
                    entity_id,
                    value_f,
                    mode,
                )
            except Exception as err:
                _LOGGER.warning(
                    "Battery optimization: failed to set %s — %s",
                    entity_id,
                    err,
                )

    async def _notify_out_of_range(
        self,
        entity_id: str,
        mode: str,
        value: float,
        min_val: float,
        max_val: float,
    ) -> None:
        """Create a persistent notification when a configured value is rejected."""
        mode_label = "Power outage" if mode == "outage" else "Daily operation"
        message = (
            f"The {mode_label} value **{value}** for `{entity_id}` is outside "
            f"the allowed range [{min_val}, {max_val}]. The value was not applied.\n\n"
            "Open the Battery Guard panel → Battery tab to correct it."
        )
        await self.hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": "⚠️ Battery Guard: value out of range",
                "message": message,
                "notification_id": f"battery_guard_oor_{entity_id}_{mode}",
            },
            blocking=True,
        )

    async def _on_power_outage(self) -> None:
        """Handle power outage: activate emergency mode, tier 1 off, notify."""
        async with self._operation_lock:
            # Re-entry guard (#45): if an outage is already active, a grid
            # flicker (off→on within the restore window re-arms the outage
            # debounce) must NOT re-shed tier 1 or re-send the outage
            # notification. Gate primarily on the in-process _outage_start_time
            # (immune to a transient `unavailable` of the active switch — the
            # weakness _handle_active_change also guards against); the active
            # switch is a secondary layer that also covers an emergency
            # restored across a reboot. A genuine new outage runs only after a
            # completed restore cleared both.
            if self._outage_start_time is not None or self._get_switch_state("active"):
                _LOGGER.debug("Outage already active — skipping re-entry")
                return

            _LOGGER.warning("Power outage detected — activating Battery Guard")
            self._outage_start_time = time.monotonic()

            # Set active switch
            active_entity = self._find_entity("active")
            if active_entity:
                await self.hass.services.async_call(
                    "switch", "turn_on", {}, target={"entity_id": active_entity}
                )

            # Apply battery optimization (outage values)
            await self._apply_battery_optimization("outage")

            # Turn off tier 1
            await self.hass.services.async_call(
                DOMAIN, "tier_off", {"tier": LABEL_TIER1}, blocking=True
            )

            # Check for failures
            result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
            failed = result.get("failed", [])
            unreachable = result.get("unreachable", [])
            total = result.get("total", 0)
            action_counts = result.get("action_counts", {})

            soc = self._get_soc_value()
            soc_text = f"Battery: {soc:.0f}%" if soc is not None else ""

            status = self._format_action_result(
                total, failed, action_counts, unreachable
            )
            message = f"Tier 1: {status}\n{soc_text}"

            await self.hass.services.async_call(
                DOMAIN,
                "notify",
                {
                    "title": "⚡ Power Outage Detected",
                    "message": message.strip(),
                    "critical": True,
                },
                blocking=True,
            )

            # Level-based SOC check: an outage that begins ALREADY below the
            # tier-2 / critical thresholds produces no downward crossing, so the
            # crossing handlers in _handle_soc_change never fire. Evaluate the
            # current level here (we already hold _operation_lock, so call the
            # lock-free _shed_tier2_locked; _on_critical_soc is lock-free too).
            if soc is not None:
                tier2_threshold = self._get_threshold("tier2_threshold")
                if (
                    tier2_threshold is not None
                    and soc < tier2_threshold
                    and not self._get_switch_state("tier2_disabled")
                ):
                    await self._shed_tier2_locked(soc, tier2_threshold)
                if soc < self._critical_soc and not self._critical_alerted:
                    self._critical_alerted = True
                    await self._on_critical_soc(soc)

    async def _on_grid_restored(self) -> None:
        """Handle grid restored: restore all, notify."""
        async with self._operation_lock:
            # Only act if emergency mode was active
            if not self._get_switch_state("active"):
                return

            # #70: restoring requires a POSITIVELY confirmed on-grid reading of
            # the raw source — never merely the absence of an outage signal.
            # The binary sensor collapses a dead source to "no outage", which
            # here would mean "switch every shed load back on mid-outage".
            # Re-evaluated now (not when the debounce was armed), so a
            # transient on-grid reading is rejected at fire time.
            grid = self._grid_state()
            if grid != GRID_ON:
                if grid == GRID_UNKNOWN:
                    message = self._claim_suspension_notice()
                    if message is not None:
                        # Awaited, unlike the listener path: this is the only
                        # signal the operator gets, and a lost task would make
                        # the suspension as silent as the bug it replaces.
                        await self.hass.services.async_call(
                            DOMAIN,
                            "notify",
                            self._suspension_payload(message),
                            blocking=True,
                        )
                else:
                    _LOGGER.warning(
                        "Grid source still reports off-grid — restore suspended"
                    )
                return

            _LOGGER.info("Grid power restored — resetting Battery Guard")

            # Read before restore_all: it turns the `active` switch off, and the
            # resulting state event clears _outage_start_time (see
            # _handle_active_change) while we are still awaiting.
            outage_start = self._outage_start_time
            self._restore_in_progress = True
            try:
                await self.hass.services.async_call(
                    DOMAIN, "restore_all", {}, blocking=True
                )

                # Restore battery optimization (normal values)
                await self._apply_battery_optimization("normal")

                # Check for failures from restore
                result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
                failed = result.get("failed", [])

                soc = self._get_soc_value()
                soc_text = f"Battery: {soc:.0f}%" if soc is not None else ""

                # Calculate outage duration
                duration_text = ""
                if outage_start is not None:
                    elapsed = time.monotonic() - outage_start
                    duration_text = f"Outage duration: {self._format_duration(elapsed)}"
                self._outage_start_time = None

                action_counts = result.get("action_counts", {})
                status = self._format_action_result(
                    result.get("total", 0), failed, action_counts
                )
                parts = [status, soc_text, duration_text]
                message = "\n".join(p for p in parts if p)

                await self.hass.services.async_call(
                    DOMAIN,
                    "notify",
                    {
                        "title": "✅ Grid Power Restored",
                        "message": message,
                        "critical": False,
                    },
                    blocking=True,
                )
            finally:
                self._restore_in_progress = False

    # =========================================================================
    # 2, 4, 5: SOC Threshold Events
    # =========================================================================
    @callback
    def _handle_soc_change(self, event: Event) -> None:
        """Handle SOC sensor state changes."""
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")

        if new_state is None or new_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return
        if old_state is None or old_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return

        try:
            new_soc = float(new_state.state)
            old_soc = float(old_state.state)
        except (ValueError, TypeError):
            return

        # Only process if emergency mode is active
        if not self._get_switch_state("active"):
            return

        # Automation 2: SOC drops below tier 2 threshold
        tier2_threshold = self._get_threshold("tier2_threshold")
        if tier2_threshold is not None:
            if (
                old_soc >= tier2_threshold
                and new_soc < tier2_threshold
                and not self._get_switch_state("tier2_disabled")
            ):
                self.hass.async_create_task(
                    self._on_soc_below_threshold(new_soc, tier2_threshold)
                )

        # Automation 4: SOC recovers above recovery threshold
        recovery_threshold = self._get_threshold("tier2_recovery_threshold")
        if recovery_threshold is not None:
            if (
                old_soc <= recovery_threshold
                and new_soc > recovery_threshold
                and self._get_switch_state("auto_recovery")
                and self._get_switch_state("tier2_disabled")
            ):
                self.hass.async_create_task(
                    self._on_soc_recovered(new_soc, recovery_threshold)
                )

        # Automation 5: Critical SOC level (de-duped via _critical_alerted)
        if (
            old_soc >= self._critical_soc
            and new_soc < self._critical_soc
            and not self._critical_alerted
        ):
            self._critical_alerted = True
            self.hass.async_create_task(self._on_critical_soc(new_soc))

    async def _on_soc_below_threshold(
        self, current_soc: float, threshold: float
    ) -> None:
        """Handle SOC dropping below tier 2 threshold."""
        async with self._operation_lock:
            await self._shed_tier2_locked(current_soc, threshold)

    async def _shed_tier2_locked(self, current_soc: float, threshold: float) -> None:
        """Turn off tier 2, set the disabled flag, and notify.

        The caller MUST already hold ``self._operation_lock``. The lock is
        non-reentrant, so this lock-free body is shared by
        ``_on_soc_below_threshold`` (crossing) and ``_on_power_outage``
        (level evaluation at outage start).
        """
        _LOGGER.warning(
            "SOC %.1f%% below threshold %.1f%% — turning off tier 2",
            current_soc,
            threshold,
        )

        # Turn off tier 2
        await self.hass.services.async_call(
            DOMAIN, "tier_off", {"tier": LABEL_TIER2}, blocking=True
        )

        # Check for failures
        result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
        failed = result.get("failed", [])
        unreachable = result.get("unreachable", [])
        total = result.get("total", 0)
        action_counts = result.get("action_counts", {})

        # Set tier2_disabled flag
        tier2_disabled_entity = self._find_entity("tier2_disabled")
        if tier2_disabled_entity:
            await self.hass.services.async_call(
                "switch",
                "turn_on",
                {},
                target={"entity_id": tier2_disabled_entity},
            )

        status = self._format_action_result(total, failed, action_counts, unreachable)
        message = f"Tier 2: {status}\nBattery: {current_soc:.0f}%"

        await self.hass.services.async_call(
            DOMAIN,
            "notify",
            {
                "title": "🔋 Low Battery — Tier 2 Off",
                "message": message,
                "critical": False,
            },
            blocking=True,
        )

    async def _on_soc_recovered(self, current_soc: float, threshold: float) -> None:
        """Handle SOC recovering above recovery threshold."""
        async with self._operation_lock:
            _LOGGER.info(
                "SOC %.1f%% above recovery threshold %.1f%% — restoring tier 2",
                current_soc,
                threshold,
            )

            # Restore tier 2
            await self.hass.services.async_call(
                DOMAIN, "tier_on", {"tier": LABEL_TIER2}, blocking=True
            )

            # Check for failures
            result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
            failed = result.get("failed", [])

            # Clear tier2_disabled flag
            tier2_disabled_entity = self._find_entity("tier2_disabled")
            if tier2_disabled_entity:
                await self.hass.services.async_call(
                    "switch",
                    "turn_off",
                    {},
                    target={"entity_id": tier2_disabled_entity},
                )

            total = result.get("total", 0)
            action_counts = result.get("action_counts", {})
            status = self._format_action_result(total, failed, action_counts)
            message = f"Tier 2: {status}\nBattery: {current_soc:.0f}%"

            await self.hass.services.async_call(
                DOMAIN,
                "notify",
                {
                    "title": "🔋 Battery Recovered — Tier 2 On",
                    "message": message,
                    "critical": False,
                },
                blocking=True,
            )

    async def _on_critical_soc(self, current_soc: float) -> None:
        """Handle critical battery level.

        Also preemptively saves T3 device states so they can be restored
        if the battery reaches 0% and all devices lose power.
        """
        _LOGGER.critical(
            "CRITICAL: Battery at %.1f%% — only tier 3 devices active",
            current_soc,
        )

        await self.hass.services.async_call(
            DOMAIN,
            "notify",
            {
                "title": f"🚨 CRITICAL: Battery at {current_soc:.0f}%!",
                "message": (
                    "Only Tier 3 devices still active.\n"
                    "Minimize all non-essential consumption!"
                ),
                "critical": True,
            },
            blocking=True,
        )

        # Preemptively save T3 device states before potential total power loss
        actual_label_id = resolve_label_id(self.hass, LABEL_TIER3)
        if actual_label_id:
            registry = er.async_get(self.hass)
            entities = er.async_entries_for_label(registry, actual_label_id)
            state_store = self.hass.data.get(DOMAIN, {}).get("state_store")
            if state_store:
                count = 0
                for entity in entities:
                    if not entity.disabled_by:
                        state_store.save_state(entity.entity_id)
                        count += 1
                _LOGGER.info(
                    "Saved %d T3 device states preemptively (critical SOC)", count
                )

    # =========================================================================
    # 6: Unassigned Devices
    # =========================================================================
    @callback
    def _handle_unassigned_change(self, event: Event) -> None:
        """Handle unassigned device count change."""
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")

        if new_state is None or new_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return
        if old_state is None or old_state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return

        try:
            new_count = int(float(new_state.state))
            old_count = int(float(old_state.state))
        except (ValueError, TypeError):
            return

        if new_count > old_count:
            self.hass.async_create_task(self._on_new_unassigned(new_count))

    async def _on_new_unassigned(self, count: int) -> None:
        """Handle new unassigned devices detected."""
        _LOGGER.info("%d unassigned devices detected", count)

        await self.hass.services.async_call(
            DOMAIN,
            "notify",
            {
                "title": "🔌 New Unassigned Devices",
                "message": (
                    f"There are {count} devices without a Battery Guard label. "
                    "Open the Battery Guard panel to assign them to tiers."
                ),
                "critical": False,
            },
            blocking=True,
        )

    # =========================================================================
    # Helpers
    # =========================================================================
    def _get_soc_value(self) -> float | None:
        """Get current SOC value."""
        if not self._soc_sensor:
            return None
        state = self.hass.states.get(self._soc_sensor)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return None
        try:
            return float(state.state)
        except (ValueError, TypeError):
            return None

    def _friendly_name(self, entity_id: str) -> str:
        """Get friendly name for an entity, falling back to entity_id."""
        state = self.hass.states.get(entity_id)
        if state and state.attributes.get("friendly_name"):
            return state.attributes["friendly_name"]
        return entity_id

    def _format_action_result(
        self,
        total: int,
        failed: list[str],
        action_counts: dict[str, int] | None = None,
        unreachable: list[str] | None = None,
    ) -> str:
        """Format action result as ✅/⚠️ status line with action breakdown.

        An ``unreachable`` device was unavailable when Battery Guard tried to shed it,
        so the shed could not be confirmed — it is NOT counted as success (#56). The ✅
        line therefore requires both ``failed`` and ``unreachable`` to be empty.

        Examples:
            "✅ 6 devices (4× off, 1× HVAC → fan_only, 1× dim → 25%)"
            "⚠️ 3/6 devices (3× off)\n  Failed: Heater\n  Unreachable: Klima Süd, Boiler"
        """
        unreachable = unreachable or []
        success_count = total - len(failed) - len(unreachable)

        # Action type breakdown
        breakdown = ""
        if action_counts:
            parts = [f"{count}× {label}" for label, count in action_counts.items()]
            breakdown = f" ({', '.join(parts)})"

        if not failed and not unreachable:
            return f"✅ {total} devices{breakdown}"
        lines = [f"⚠️ {success_count}/{total} devices{breakdown}"]
        for eid in failed:
            lines.append(f"  Failed: {self._friendly_name(eid)}")
        for eid in unreachable:
            lines.append(f"  Unreachable: {self._friendly_name(eid)}")
        return "\n".join(lines)

    @staticmethod
    def _format_duration(seconds: float) -> str:
        """Format seconds into human-readable duration."""
        minutes = int(seconds / 60)
        if minutes < 60:
            return f"{minutes} min"
        hours = minutes // 60
        remaining = minutes % 60
        if remaining == 0:
            return f"{hours}h"
        return f"{hours}h {remaining}min"
