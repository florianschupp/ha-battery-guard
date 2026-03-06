"""DataUpdateCoordinator for Battery Guard."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, TRACKED_DOMAINS
from .labels import get_label_map

_LOGGER = logging.getLogger(__name__)


class BatteryGuardCoordinator(DataUpdateCoordinator):
    """Coordinator for Battery Guard data updates."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=5),
        )
        self.entry = entry

    async def _async_update_data(self) -> dict:
        """Fetch data: count unassigned entities."""
        registry = er.async_get(self.hass)

        # Collect all entities assigned to battery_guard labels
        assigned_ids: set[str] = set()
        label_map = get_label_map(self.hass)
        for actual_label_id in label_map.values():
            for entry in er.async_entries_for_label(registry, actual_label_id):
                assigned_ids.add(entry.entity_id)

        # Find unassigned entities in tracked domains
        unassigned: list[str] = []
        for entry in registry.entities.values():
            domain = entry.entity_id.split(".")[0]
            if domain in TRACKED_DOMAINS and not entry.disabled_by:
                if entry.entity_id not in assigned_ids:
                    unassigned.append(entry.entity_id)

        return {
            "unassigned_count": len(unassigned),
            "unassigned_entities": unassigned,
        }
