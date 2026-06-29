"""Sensor health monitoring for Battery Guard.

A fail-isolated watchdog that tracks the availability of the source sensors
Battery Guard depends on (grid/voltage, SOC, enabled battery-optimization
entities). When a required source becomes unavailable for longer than a
debounce window it sends a notification and logs the event; recovery is also
reported. A snapshot of per-source availability is published for the panel
health page.

Sources are logical, not per-entity: the three voltage phases form ONE source
("Grid voltage") so a single grid loss raises one alert, not three. A source is
available only while all of its underlying entities are available.

This module performs NO control actions and shares no locks with the
automation engine, so a watchdog fault cannot disturb outage/restore logic.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, State, callback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
)
from homeassistant.util import dt as dt_util

from .const import (
    CONF_BATTERY_OPTIMIZATION,
    CONF_GRID_SENSOR,
    CONF_SOC_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DATA_SENSOR_HEALTH,
    DEFAULT_BATTERY_OPTIMIZATION,
    DOMAIN,
    HEALTH_DEBOUNCE_SECONDS,
    HEALTH_STARTUP_GRACE_SECONDS,
)

_LOGGER = logging.getLogger(__name__)


def _is_available(state: State | None) -> bool:
    """Return True if a state exists and is not unavailable/unknown."""
    return state is not None and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)


class SensorHealthMonitor:
    """Watches required source sensors and reports availability changes."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the monitor."""
        self.hass = hass
        self.entry = entry
        # source key -> {key, role, entity_ids, available, last_available, alerted}
        self._status: dict[str, dict[str, Any]] = {}
        # entity_id -> source key (for routing state-change events)
        self._entity_index: dict[str, str] = {}
        self._unsub: CALLBACK_TYPE | None = None
        # source key -> cancel handle for a pending unavailable-debounce timer
        self._debounce: dict[str, CALLBACK_TYPE] = {}
        self._startup_handle: CALLBACK_TYPE | None = None

    def _build_sources(self) -> list[dict[str, Any]]:
        """Build the list of required logical sources from the config entry.

        Empty/unconfigured values are excluded (grid/SOC sensors default to ""
        and are set later via the Options flow). Battery-optimization entities
        are only included when optimization is enabled. Charge/discharge
        entities are intentionally excluded — no runtime logic consumes them.
        The three voltage phases collapse into one "Grid voltage" source.
        """
        data = self.entry.data
        sources: list[dict[str, Any]] = []

        if data.get(CONF_USE_VOLTAGE, False):
            phases = [
                data.get(key, "")
                for key in (
                    CONF_VOLTAGE_PHASE_A,
                    CONF_VOLTAGE_PHASE_B,
                    CONF_VOLTAGE_PHASE_C,
                )
            ]
            phases = [p for p in phases if p]
            if phases:
                sources.append(
                    {
                        "key": "voltage",
                        "role": "Grid voltage (3-phase)",
                        "entity_ids": phases,
                    }
                )
        else:
            grid = data.get(CONF_GRID_SENSOR, "")
            if grid:
                sources.append(
                    {"key": grid, "role": "Grid sensor", "entity_ids": [grid]}
                )

        soc = data.get(CONF_SOC_SENSOR, "")
        if soc:
            sources.append({"key": soc, "role": "SOC sensor", "entity_ids": [soc]})

        opt = data.get(CONF_BATTERY_OPTIMIZATION, DEFAULT_BATTERY_OPTIMIZATION)
        if opt.get("enabled", False):
            for entity_cfg in opt.get("entities", []):
                entity_id = entity_cfg.get("entity_id", "")
                if entity_id:
                    sources.append(
                        {
                            "key": entity_id,
                            "role": f"Battery optimization: {entity_id}",
                            "entity_ids": [entity_id],
                        }
                    )

        return sources

    def _source_available(self, status: dict[str, Any]) -> bool:
        """A source is available only while all its entities are available."""
        return all(
            _is_available(self.hass.states.get(eid)) for eid in status["entity_ids"]
        )

    async def async_start(self) -> None:
        """Build the required sources, seed status, and start listening."""
        for source in self._build_sources():
            key = source["key"]
            for entity_id in source["entity_ids"]:
                self._entity_index[entity_id] = key
            status = {
                "key": key,
                "role": source["role"],
                "entity_ids": list(source["entity_ids"]),
                "available": False,
                "last_available": None,
                "alerted": False,
            }
            # Seed from current states (state-change events do not fire for
            # entities that already exist at start).
            status["available"] = self._source_available(status)
            if status["available"]:
                status["last_available"] = dt_util.utcnow().isoformat()
            self._status[key] = status

        self._publish()

        if self._entity_index:
            self._unsub = async_track_state_change_event(
                self.hass, list(self._entity_index), self._handle_change
            )

        # One-shot startup check after a grace delay: entities can come online
        # late after a reboot, so we re-read current state before alerting on a
        # source that has been unavailable since startup.
        self._startup_handle = async_call_later(
            self.hass, HEALTH_STARTUP_GRACE_SECONDS, self._startup_check
        )

        _LOGGER.debug(
            "Sensor health monitor started (%d sources, %d entities)",
            len(self._status),
            len(self._entity_index),
        )

    async def async_stop(self) -> None:
        """Cancel all listeners and pending timers."""
        if self._unsub:
            self._unsub()
            self._unsub = None
        if self._startup_handle:
            self._startup_handle()
            self._startup_handle = None
        for cancel in self._debounce.values():
            cancel()
        self._debounce.clear()

    @callback
    def _handle_change(self, event: Event) -> None:
        """Route a tracked entity's state change to its source."""
        key = self._entity_index.get(event.data["entity_id"])
        if key is not None:
            self._reevaluate(key)

    @callback
    def _reevaluate(self, key: str) -> None:
        """Recompute a source's availability and arm/clear debounce as needed."""
        status = self._status.get(key)
        if status is None:
            return

        if self._source_available(status):
            status["available"] = True
            status["last_available"] = dt_util.utcnow().isoformat()
            cancel = self._debounce.pop(key, None)
            if cancel:
                cancel()
            if status["alerted"]:
                status["alerted"] = False
                self._notify_recovered(status)
        else:
            status["available"] = False
            # Arm a debounce timer only if none is pending and we have not
            # already alerted for this ongoing outage.
            if key not in self._debounce and not status["alerted"]:
                self._debounce[key] = async_call_later(
                    self.hass,
                    HEALTH_DEBOUNCE_SECONDS,
                    lambda _now, k=key: self._debounce_fired(k),
                )

        self._publish()

    @callback
    def _debounce_fired(self, key: str) -> None:
        """Fire when a source has stayed unavailable past the debounce window."""
        self._debounce.pop(key, None)
        status = self._status.get(key)
        if status is None:
            return

        if self._source_available(status):
            # Recovered right at the edge of the window — refresh and bail.
            status["available"] = True
            status["last_available"] = dt_util.utcnow().isoformat()
            self._publish()
            return

        status["alerted"] = True
        self._notify_unavailable(status)
        self._publish()

    @callback
    def _startup_check(self, _now: Any) -> None:
        """Report sources that have been unavailable since startup."""
        self._startup_handle = None
        for key, status in self._status.items():
            available = self._source_available(status)
            status["available"] = available
            if (
                not available
                and not status["alerted"]
                and key not in self._debounce
            ):
                status["alerted"] = True
                self._notify_unavailable(status)
        self._publish()

    def _notify_unavailable(self, status: dict[str, Any]) -> None:
        """Log + notify that a source became unavailable."""
        role = status["role"]
        detail = ", ".join(status["entity_ids"])
        _LOGGER.warning(
            "Source unavailable: %s (%s) — Battery Guard monitoring degraded",
            role,
            detail,
        )
        self.hass.async_create_task(
            self._send_notify(
                title="⚠️ Battery Guard: sensor unavailable",
                message=f"{role} ({detail}) is unavailable — monitoring degraded.",
            )
        )

    def _notify_recovered(self, status: dict[str, Any]) -> None:
        """Log + notify that a source recovered."""
        role = status["role"]
        detail = ", ".join(status["entity_ids"])
        _LOGGER.info("Source available again: %s (%s)", role, detail)
        self.hass.async_create_task(
            self._send_notify(
                title="✅ Battery Guard: sensor available",
                message=f"{role} ({detail}) is available again.",
            )
        )

    async def _send_notify(self, title: str, message: str) -> None:
        """Send a notification via the Battery Guard notify service.

        Swallows all errors — the watchdog must never raise into HA.
        """
        try:
            await self.hass.services.async_call(
                DOMAIN,
                "notify",
                {"title": title, "message": message, "critical": False},
                blocking=False,
            )
        except Exception:  # noqa: BLE001 - watchdog must never raise
            _LOGGER.exception("Failed to send sensor-health notification")

    @callback
    def _publish(self) -> None:
        """Publish the current snapshot for the websocket health command."""
        self.hass.data.setdefault(DOMAIN, {})[DATA_SENSOR_HEALTH] = self.snapshot()

    def snapshot(self) -> list[dict[str, Any]]:
        """Return the current per-source health snapshot."""
        result: list[dict[str, Any]] = []
        for status in self._status.values():
            entity_ids = status["entity_ids"]
            if len(entity_ids) == 1:
                state_obj = self.hass.states.get(entity_ids[0])
                state = state_obj.state if state_obj is not None else None
                entity_id = entity_ids[0]
            else:
                available_count = sum(
                    1 for eid in entity_ids if _is_available(self.hass.states.get(eid))
                )
                state = f"{available_count}/{len(entity_ids)} available"
                entity_id = ", ".join(entity_ids)
            result.append(
                {
                    "entity_id": entity_id,
                    "role": status["role"],
                    "available": status["available"],
                    "state": state,
                    "last_available": status["last_available"],
                }
            )
        return result
