"""Switch entities for Battery Guard status flags."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN, VERSION


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Battery Guard switch entities."""
    async_add_entities(
        [
            BatteryGuardSwitch(
                entry,
                key="active",
                name="Emergency Mode Active",
                icon="mdi:flash-alert",
                default=False,
            ),
            BatteryGuardSwitch(
                entry,
                key="auto_recovery",
                name="Auto-Recovery Tier 2",
                icon="mdi:autorenew",
                default=True,
            ),
            BatteryGuardSwitch(
                entry,
                key="tier2_disabled",
                name="Tier 2 Disabled",
                icon="mdi:power-plug-off",
                default=False,
            ),
            BatteryGuardSwitch(
                entry,
                key="simulation",
                name="Simulation Mode",
                icon="mdi:test-tube",
                default=False,
            ),
        ]
    )


class BatteryGuardSwitch(RestoreEntity, SwitchEntity):
    """A Battery Guard status switch."""

    _attr_has_entity_name = True

    def __init__(
        self,
        entry: ConfigEntry,
        key: str,
        name: str,
        icon: str,
        default: bool,
    ) -> None:
        """Initialize the switch."""
        self._entry = entry
        self._key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_name = name
        self._attr_icon = icon
        self._default = default
        self._attr_is_on = default

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
        """Restore previous state on startup."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            self._attr_is_on = last_state.state == "on"

    async def async_turn_on(self, **kwargs) -> None:
        """Turn on the switch."""
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        """Turn off the switch."""
        self._attr_is_on = False
        self.async_write_ha_state()
