"""Number entities for Battery Guard thresholds."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    DOMAIN,
    VERSION,
    CONF_TIER2_THRESHOLD,
    CONF_RECOVERY_THRESHOLD,
    DEFAULT_TIER2_THRESHOLD,
    DEFAULT_TIER2_RECOVERY_THRESHOLD,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Battery Guard number entities."""
    async_add_entities(
        [
            BatteryGuardThresholdNumber(
                entry,
                key="tier2_threshold",
                name="Tier 2 Shutdown Threshold",
                icon="mdi:battery-alert",
                default=entry.data.get(CONF_TIER2_THRESHOLD, DEFAULT_TIER2_THRESHOLD),
            ),
            BatteryGuardThresholdNumber(
                entry,
                key="tier2_recovery_threshold",
                name="Tier 2 Recovery Threshold",
                icon="mdi:battery-plus",
                default=entry.data.get(
                    CONF_RECOVERY_THRESHOLD, DEFAULT_TIER2_RECOVERY_THRESHOLD
                ),
            ),
        ]
    )


class BatteryGuardThresholdNumber(RestoreEntity, NumberEntity):
    """A configurable SOC threshold."""

    _attr_has_entity_name = True
    _attr_native_min_value = 10
    _attr_native_max_value = 90
    _attr_native_step = 5
    _attr_native_unit_of_measurement = "%"
    _attr_mode = NumberMode.SLIDER

    def __init__(
        self,
        entry: ConfigEntry,
        key: str,
        name: str,
        icon: str,
        default: float,
    ) -> None:
        """Initialize the threshold number entity."""
        self._entry = entry
        self._key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_name = name
        self._attr_icon = icon
        self._default = default
        self._attr_native_value = default

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

    async def async_added_to_hass(self) -> None:
        """Restore previous value on startup."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            self._attr_native_value = float(last_state.state)

    async def async_set_native_value(self, value: float) -> None:
        """Set the threshold value."""
        self._attr_native_value = value
        self.async_write_ha_state()
