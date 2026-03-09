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
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
)

from .const import (
    CONF_CRITICAL_SOC,
    CONF_SOC_SENSOR,
    DEFAULT_CRITICAL_SOC,
    DOMAIN,
    LABEL_TIER1,
    LABEL_TIER2,
    LABEL_TIER3,
    OUTAGE_DEBOUNCE_SECONDS,
    RESTORE_DEBOUNCE_SECONDS,
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
        self._operation_lock = asyncio.Lock()

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

    async def async_stop(self) -> None:
        """Stop all event listeners and cancel pending debounce timers."""
        _LOGGER.info("Stopping Battery Guard automation engine")
        if self._outage_debounce_handle:
            self._outage_debounce_handle()
            self._outage_debounce_handle = None
        if self._restore_debounce_handle:
            self._restore_debounce_handle()
            self._restore_debounce_handle = None
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
                _LOGGER.info("Grid flicker detected — outage cancelled (< %ds)", OUTAGE_DEBOUNCE_SECONDS)
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

    async def _on_power_outage(self) -> None:
        """Handle power outage: activate emergency mode, tier 1 off, notify."""
        async with self._operation_lock:
            _LOGGER.warning("Power outage detected — activating Battery Guard")

            # Set active switch
            active_entity = self._find_entity("active")
            if active_entity:
                await self.hass.services.async_call(
                    "switch", "turn_on", {}, target={"entity_id": active_entity}
                )

            # Turn off tier 1
            await self.hass.services.async_call(
                DOMAIN, "tier_off", {"tier": LABEL_TIER1}, blocking=True
            )

            # Check for failures
            result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
            failed = result.get("failed", [])
            total = result.get("total", 0)

            # Get current SOC for notification
            soc = self._get_soc_value()
            soc_text = f"Battery: {soc:.0f}%" if soc is not None else ""

            message = (
                f"Power outage detected! Tier 1 devices shut down "
                f"({total - len(failed)}/{total} successful). {soc_text}"
            )
            if failed:
                message += (
                    f"\n\n⚠️ {len(failed)} device(s) failed to respond:\n"
                    + "\n".join(f"- {eid}" for eid in failed)
                )

            await self.hass.services.async_call(
                DOMAIN,
                "notify",
                {
                    "title": "⚡ Power Outage Detected",
                    "message": message,
                    "critical": True,
                },
                blocking=True,
            )

    async def _on_grid_restored(self) -> None:
        """Handle grid restored: restore all, notify."""
        async with self._operation_lock:
            # Only act if emergency mode was active
            if not self._get_switch_state("active"):
                return

            _LOGGER.info("Grid power restored — resetting Battery Guard")

            await self.hass.services.async_call(
                DOMAIN, "restore_all", {}, blocking=True
            )

            # Check for failures from restore
            result = self.hass.data.get(DOMAIN, {}).get("last_action_result", {})
            failed = result.get("failed", [])

            soc = self._get_soc_value()
            soc_text = f"Battery: {soc:.0f}%" if soc is not None else ""

            message = f"Grid power is back! Devices have been restored. {soc_text}"
            if failed:
                message += (
                    f"\n\n⚠️ {len(failed)} device(s) failed to restore:\n"
                    + "\n".join(f"- {eid}" for eid in failed)
                )

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

        # Automation 5: Critical SOC level
        if old_soc >= self._critical_soc and new_soc < self._critical_soc:
            self.hass.async_create_task(self._on_critical_soc(new_soc))

    async def _on_soc_below_threshold(
        self, current_soc: float, threshold: float
    ) -> None:
        """Handle SOC dropping below tier 2 threshold."""
        async with self._operation_lock:
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
            total = result.get("total", 0)

            # Set tier2_disabled flag
            tier2_disabled_entity = self._find_entity("tier2_disabled")
            if tier2_disabled_entity:
                await self.hass.services.async_call(
                    "switch",
                    "turn_on",
                    {},
                    target={"entity_id": tier2_disabled_entity},
                )

            message = (
                f"Battery below {threshold:.0f}%. "
                f"Tier 2 devices shut down ({total - len(failed)}/{total} successful). "
                f"Current SOC: {current_soc:.0f}%"
            )
            if failed:
                message += (
                    f"\n\n⚠️ {len(failed)} device(s) failed to respond:\n"
                    + "\n".join(f"- {eid}" for eid in failed)
                )

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

            message = (
                f"Battery above {threshold:.0f}%. "
                "Tier 2 devices have been restored. "
                f"Current SOC: {current_soc:.0f}%"
            )
            if failed:
                message += (
                    f"\n\n⚠️ {len(failed)} device(s) failed to restore:\n"
                    + "\n".join(f"- {eid}" for eid in failed)
                )

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
                "title": "🚨 CRITICAL: Battery Below 10%!",
                "message": (
                    f"WARNING: Battery at only {current_soc:.0f}%! "
                    "Only critical devices (tier 3) are still active. "
                    "Please minimize all non-essential consumption!"
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
