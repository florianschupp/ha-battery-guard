"""Sensor entities for Battery Guard."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION
from .coordinator import BatteryGuardCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Battery Guard sensor entities."""
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([UnassignedDevicesSensor(coordinator, entry)])


class UnassignedDevicesSensor(CoordinatorEntity[BatteryGuardCoordinator], SensorEntity):
    """Sensor counting devices not assigned to any Battery Guard tier."""

    _attr_has_entity_name = True
    _attr_name = "Unassigned Devices"
    _attr_icon = "mdi:help-circle"
    _attr_native_unit_of_measurement = "devices"

    def __init__(
        self,
        coordinator: BatteryGuardCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the unassigned devices sensor."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_unassigned_devices"
        self._attr_translation_key = "unassigned_devices"

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name="Battery Guard",
            manufacturer="Battery Guard",
            model="Emergency Power Management",
            sw_version=VERSION,
        )

    @property
    def native_value(self) -> int | None:
        """Return the count of unassigned devices."""
        if self.coordinator.data is None:
            return None
        return self.coordinator.data.get("unassigned_count", 0)

    @property
    def extra_state_attributes(self) -> dict:
        """Return the list of unassigned entity IDs."""
        if self.coordinator.data is None:
            return {"entities": []}
        return {
            "entities": self.coordinator.data.get("unassigned_entities", []),
        }
