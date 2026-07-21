"""Sensor + control-path health monitoring for Battery Guard.

A fail-isolated watchdog that tracks whether Battery Guard can still do its job.
It reports three sensor failure modes and one control-path failure mode (#56):

- **dead**   — a required source is unavailable/unknown past a debounce.
- **stale**  — a source is nominally "available" but has reported no fresh value for
  longer than the freshness window (a frozen Modbus reading keeps its last value and
  fires no state-change event — only polling can catch it).
- **unstable** — a source dropped out >= N times within a rolling window (flapping
  shorter than the debounce, which an event+debounce design never alerts on).
- **control path** — a tier-1/tier-2 device is unavailable, so it cannot be shed
  during an outage.

The watchdog is **actively polling**: a periodic sweep evaluates availability and
freshness (freshness cannot be observed from events), while a lightweight state-change
listener records flap edges at the *source* level (a single grid loss that drops all
three voltage phases records ONE edge, not three).

This module performs NO control actions and shares no locks with the automation engine,
so a watchdog fault cannot disturb outage/restore logic. Every periodic body is wrapped
so it can never raise into Home Assistant.
"""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, State, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
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
    HEALTH_FLAP_THRESHOLD,
    HEALTH_FLAP_WINDOW_SECONDS,
    HEALTH_STALE_SECONDS,
    HEALTH_STARTUP_GRACE_SECONDS,
    HEALTH_SWEEP_SECONDS,
    LABEL_TIER1,
    LABEL_TIER2,
)
from .labels import resolve_label_id

_LOGGER = logging.getLogger(__name__)

_STALE_MINUTES = HEALTH_STALE_SECONDS // 60
_FLAP_MINUTES = HEALTH_FLAP_WINDOW_SECONDS // 60


def _is_available(state: State | None) -> bool:
    """Return True if a state exists and is not unavailable/unknown."""
    return state is not None and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)


def _reason(available: bool, fresh: bool, flapping: bool) -> str:
    """Classify the current unhealthy reason (highest-signal first)."""
    if flapping:
        return "unstable"
    if not available:
        return "dead"
    if not fresh:
        return "stale"
    return "healthy"


class SensorHealthMonitor:
    """Actively polling watchdog for source sensors and the tier control path."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the monitor."""
        self.hass = hass
        self.entry = entry
        # source key -> status dict (sensor sources; static, from config)
        self._status: dict[str, dict[str, Any]] = {}
        # entity_id -> source key (routing flap-edge events)
        self._entity_index: dict[str, str] = {}
        # entity_id -> control-path status dict (dynamic, from tier labels)
        self._control: dict[str, dict[str, Any]] = {}
        self._unsub_change: CALLBACK_TYPE | None = None
        self._unsub_sweep: CALLBACK_TYPE | None = None
        self._start_time: datetime | None = None

    # ------------------------------------------------------------------ build
    def _build_sources(self) -> list[dict[str, Any]]:
        """Build the list of required logical sensor sources from the config entry.

        Empty/unconfigured values are excluded. Battery-optimization entities are only
        included when optimization is enabled. Charge/discharge entities are intentionally
        excluded — no runtime logic consumes them. The three voltage phases collapse into
        one "Grid voltage" source so a single grid loss raises one alert, not three.
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
                        "check_freshness": True,
                    }
                )
        else:
            grid = data.get(CONF_GRID_SENSOR, "")
            if grid:
                sources.append(
                    {
                        "key": grid,
                        "role": "Grid sensor",
                        "entity_ids": [grid],
                        "check_freshness": True,
                    }
                )

        soc = data.get(CONF_SOC_SENSOR, "")
        if soc:
            sources.append(
                {
                    "key": soc,
                    "role": "SOC sensor",
                    "entity_ids": [soc],
                    "check_freshness": True,
                }
            )

        opt = data.get(CONF_BATTERY_OPTIMIZATION, DEFAULT_BATTERY_OPTIMIZATION)
        if opt.get("enabled", False):
            for entity_cfg in opt.get("entities", []):
                entity_id = entity_cfg.get("entity_id", "")
                if entity_id:
                    # Battery-optimization number entities are actuator-like — Battery
                    # Guard writes them, and their integration may not re-report on a
                    # fixed cadence. Freshness would false-alarm on a healthy-but-quiet
                    # one, so they are watched by availability only (concept-review).
                    sources.append(
                        {
                            "key": entity_id,
                            "role": f"Battery optimization: {entity_id}",
                            "entity_ids": [entity_id],
                            "check_freshness": False,
                        }
                    )

        return sources

    @staticmethod
    def _new_status(
        key: str, role: str, entity_ids: list[str], check_freshness: bool
    ) -> dict[str, Any]:
        """Create a fresh per-source status record."""
        return {
            "key": key,
            "role": role,
            "entity_ids": list(entity_ids),
            "check_freshness": check_freshness,
            "available": False,
            "fresh": True,
            "healthy": False,
            "reason": "healthy",
            "last_available": None,
            "unhealthy_since": None,
            "alerted": False,
            "alert_reason": None,
            "flap_edges": deque(),
        }

    # ------------------------------------------------------------------ helpers
    def _source_available(self, status: dict[str, Any]) -> bool:
        """A source is available only while all of its entities are available."""
        return all(
            _is_available(self.hass.states.get(eid)) for eid in status["entity_ids"]
        )

    def _source_fresh(self, status: dict[str, Any], now: datetime) -> bool:
        """Fresh if the oldest ``last_reported`` across entities is within the window.

        Fail-open: a missing ``last_reported`` (should not happen on HA >= 2024.8) is
        treated as fresh — a staleness alert is never invented from a missing timestamp.
        ``last_updated`` is deliberately NOT used as a fallback: it only ticks on a
        value/attribute change, so a legitimately-static-but-healthy sensor would look
        stale.
        """
        oldest: datetime | None = None
        for eid in status["entity_ids"]:
            state = self.hass.states.get(eid)
            last_reported = getattr(state, "last_reported", None) if state else None
            if last_reported is None:
                continue
            if oldest is None or last_reported < oldest:
                oldest = last_reported
        if oldest is None:
            return True
        return (now - oldest).total_seconds() <= HEALTH_STALE_SECONDS

    @staticmethod
    def _prune_edges(edges: deque, now: datetime) -> None:
        """Drop flap edges older than the flap window."""
        cutoff = now - timedelta(seconds=HEALTH_FLAP_WINDOW_SECONDS)
        while edges and edges[0] < cutoff:
            edges.popleft()

    def _in_startup_grace(self, now: datetime) -> bool:
        """True while still inside the startup grace window."""
        if self._start_time is None:
            return False
        return (now - self._start_time).total_seconds() < HEALTH_STARTUP_GRACE_SECONDS

    # ------------------------------------------------------------------ lifecycle
    async def async_start(self) -> None:
        """Build sources, seed status, and start the listener + periodic sweep."""
        self._start_time = dt_util.utcnow()

        for source in self._build_sources():
            key = source["key"]
            for entity_id in source["entity_ids"]:
                self._entity_index[entity_id] = key
            status = self._new_status(
                key, source["role"], source["entity_ids"], source["check_freshness"]
            )
            status["available"] = self._source_available(status)
            if status["available"]:
                status["last_available"] = self._start_time.isoformat()
                status["healthy"] = True
            self._status[key] = status

        self._publish()

        if self._entity_index:
            self._unsub_change = async_track_state_change_event(
                self.hass, list(self._entity_index), self._handle_change
            )

        # Periodic sweep — the decision engine. It also runs the one-shot startup logic
        # (no alerts inside the grace window), so there is no separate startup path.
        self._unsub_sweep = async_track_time_interval(
            self.hass, self._sweep, timedelta(seconds=HEALTH_SWEEP_SECONDS)
        )

        _LOGGER.debug(
            "Sensor health monitor started (%d sources, %d entities)",
            len(self._status),
            len(self._entity_index),
        )

    async def async_stop(self) -> None:
        """Cancel the listener and the periodic sweep."""
        if self._unsub_change:
            self._unsub_change()
            self._unsub_change = None
        if self._unsub_sweep:
            self._unsub_sweep()
            self._unsub_sweep = None

    # ------------------------------------------------------------------ flap edges
    @callback
    def _handle_change(self, event: Event) -> None:
        """Record a flap edge on a source-level available -> unavailable transition.

        Wrapped like the sweep — the watchdog must never raise into HA.
        """
        try:
            key = self._entity_index.get(event.data["entity_id"])
            if key is None:
                return
            status = self._status.get(key)
            if status is None:
                return
            was_available = status["available"]
            now_available = self._source_available(status)
            if was_available and not now_available:
                status["flap_edges"].append(dt_util.utcnow())
            status["available"] = now_available
        except Exception:  # noqa: BLE001 - watchdog must never raise
            _LOGGER.exception("Sensor health change handler failed")

    # ------------------------------------------------------------------ sweep
    @callback
    def _sweep(self, _now: Any = None) -> None:
        """Periodic evaluation of every source + control-path device.

        Wrapped so a watchdog fault can never raise into Home Assistant.
        """
        try:
            now = dt_util.utcnow()
            in_grace = self._in_startup_grace(now)
            for status in self._status.values():
                self._evaluate_source(status, now, in_grace)
            self._evaluate_control_path(now, in_grace)
            self._publish()
        except Exception:  # noqa: BLE001 - watchdog must never raise
            _LOGGER.exception("Sensor health sweep failed")

    def _evaluate_source(
        self, status: dict[str, Any], now: datetime, in_grace: bool
    ) -> None:
        """Run the dead/stale/unstable state machine for one sensor source."""
        self._prune_edges(status["flap_edges"], now)
        flaps = len(status["flap_edges"])
        flapping = flaps >= HEALTH_FLAP_THRESHOLD

        available = self._source_available(status)
        status["available"] = available
        if available:
            status["last_available"] = now.isoformat()
            fresh = (
                self._source_fresh(status, now) if status["check_freshness"] else True
            )
        else:
            fresh = False
        status["fresh"] = fresh
        healthy = available and fresh
        status["healthy"] = healthy

        if in_grace:
            # Seed state for the snapshot, but never alert while HA is still warming up.
            status["reason"] = _reason(available, fresh, flapping)
            status["unhealthy_since"] = None if healthy else now
            return

        if status["alerted"]:
            if status["alert_reason"] == "unstable":
                recovered = healthy and not flapping
            else:
                recovered = healthy
            if recovered:
                status["alerted"] = False
                status["alert_reason"] = None
                status["reason"] = "healthy"
                status["unhealthy_since"] = None
                status["flap_edges"].clear()
                self._notify_recovered(status)
            else:
                status["reason"] = _reason(available, fresh, flapping)
            return

        # Not yet alerted for the current episode.
        if flapping:
            status["alerted"] = True
            status["alert_reason"] = "unstable"
            status["reason"] = "unstable"
            self._notify_degraded(status, "unstable", flaps=flaps)
        elif healthy:
            status["reason"] = "healthy"
            status["unhealthy_since"] = None
        else:
            reason = "dead" if not available else "stale"
            status["reason"] = reason
            if status["unhealthy_since"] is None:
                status["unhealthy_since"] = now
            if (now - status["unhealthy_since"]).total_seconds() >= (
                HEALTH_DEBOUNCE_SECONDS
            ):
                status["alerted"] = True
                status["alert_reason"] = reason
                self._notify_degraded(status, reason)

    def _evaluate_control_path(self, now: datetime, in_grace: bool) -> None:
        """Alert when a tier-1/tier-2 device is unavailable (cannot be shed).

        Control-path devices are resolved fresh each sweep from the tier labels, using
        the same ``disabled_by`` filter as ``handle_tier_off`` so we never warn about an
        entity the shed path would not touch. Only availability matters here — freshness
        and flapping are not evaluated for actuators.
        """
        current: set[str] = set()
        registry = None
        for label_const in (LABEL_TIER1, LABEL_TIER2):
            label_id = resolve_label_id(self.hass, label_const)
            if not label_id:
                continue
            if registry is None:
                registry = er.async_get(self.hass)
            for entry in er.async_entries_for_label(registry, label_id):
                if entry.disabled_by:
                    continue
                current.add(entry.entity_id)

        if registry is None:
            # No tier label resolved (labels not populated yet / transiently empty).
            # Short-circuit WITHOUT pruning: dropping tracked devices here would lose
            # their alerted/unhealthy_since state → a missed recovery notice or a
            # duplicate "cannot be shed" alert when the label re-resolves (concept §3.2).
            return

        # Drop devices that are no longer tier members.
        for eid in list(self._control):
            if eid not in current:
                del self._control[eid]

        for eid in current:
            cstatus = self._control.get(eid)
            if cstatus is None:
                cstatus = {
                    "key": eid,
                    "role": f"Tier device: {self._friendly(eid)}",
                    "entity_ids": [eid],
                    "kind": "control",
                    "available": False,
                    "unhealthy_since": None,
                    "alerted": False,
                }
                self._control[eid] = cstatus

            available = _is_available(self.hass.states.get(eid))
            cstatus["available"] = available

            if in_grace:
                cstatus["unhealthy_since"] = None if available else now
                continue

            if cstatus["alerted"]:
                if available:
                    cstatus["alerted"] = False
                    cstatus["unhealthy_since"] = None
                    self._notify_control_recovered(cstatus)
                continue

            if available:
                cstatus["unhealthy_since"] = None
            else:
                if cstatus["unhealthy_since"] is None:
                    cstatus["unhealthy_since"] = now
                if (now - cstatus["unhealthy_since"]).total_seconds() >= (
                    HEALTH_DEBOUNCE_SECONDS
                ):
                    cstatus["alerted"] = True
                    self._notify_control_unavailable(cstatus)

    # ------------------------------------------------------------------ notify
    def _friendly(self, entity_id: str) -> str:
        """Friendly name of an entity, falling back to the entity_id."""
        state = self.hass.states.get(entity_id)
        if state is not None and state.attributes.get("friendly_name"):
            return state.attributes["friendly_name"]
        return entity_id

    def _notify_degraded(
        self, status: dict[str, Any], reason: str, flaps: int = 0
    ) -> None:
        """Log + notify that a sensor source became dead/stale/unstable."""
        role = status["role"]
        detail = ", ".join(status["entity_ids"])
        if reason == "stale":
            title = "⚠️ Battery Guard: sensor stale"
            message = (
                f"{role} ({detail}) has reported no fresh value for over "
                f"{_STALE_MINUTES} min — monitoring degraded."
            )
        elif reason == "unstable":
            title = "⚠️ Battery Guard: connection unstable"
            message = (
                f"{role} ({detail}) dropped out {flaps} times in "
                f"{_FLAP_MINUTES} min — monitoring unreliable."
            )
        else:  # dead
            title = "⚠️ Battery Guard: sensor unavailable"
            message = f"{role} ({detail}) is unavailable — monitoring degraded."
        _LOGGER.warning("Source %s: %s (%s)", reason, role, detail)
        self.hass.async_create_task(self._send_notify(title=title, message=message))

    def _notify_recovered(self, status: dict[str, Any]) -> None:
        """Log + notify that a sensor source recovered."""
        role = status["role"]
        detail = ", ".join(status["entity_ids"])
        _LOGGER.info("Source available again: %s (%s)", role, detail)
        self.hass.async_create_task(
            self._send_notify(
                title="✅ Battery Guard: sensor available",
                message=f"{role} ({detail}) is available again.",
            )
        )

    def _notify_control_unavailable(self, cstatus: dict[str, Any]) -> None:
        """Log + notify that a tier device cannot be shed."""
        role = cstatus["role"]
        eid = cstatus["entity_ids"][0]
        _LOGGER.warning("Control path unavailable: %s (%s)", role, eid)
        self.hass.async_create_task(
            self._send_notify(
                title="⚠️ Battery Guard: device unreachable",
                message=(
                    f"{role} ({eid}) is unavailable — cannot be shed during an outage."
                ),
            )
        )

    def _notify_control_recovered(self, cstatus: dict[str, Any]) -> None:
        """Log + notify that a tier device is reachable again."""
        role = cstatus["role"]
        eid = cstatus["entity_ids"][0]
        _LOGGER.info("Control path reachable again: %s (%s)", role, eid)
        self.hass.async_create_task(
            self._send_notify(
                title="✅ Battery Guard: device reachable",
                message=f"{role} ({eid}) is reachable again.",
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

    # ------------------------------------------------------------------ snapshot
    @callback
    def _publish(self) -> None:
        """Publish the current snapshot for the websocket health command."""
        self.hass.data.setdefault(DOMAIN, {})[DATA_SENSOR_HEALTH] = self.snapshot()

    def snapshot(self) -> list[dict[str, Any]]:
        """Return the current per-source health snapshot (sensor sources).

        Keeps the existing keys (entity_id/role/available/state/last_available) for
        backward compatibility and adds ``reason`` (healthy|dead|stale|unstable). The
        control path is notification-only in #56; its panel display lands in #57.
        """
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
                    "reason": status["reason"],
                }
            )
        return result
