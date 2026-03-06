"""Binary sensor for Battery Guard power outage detection."""

from __future__ import annotations

import logging

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from .const import (
    CONF_GRID_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    DOMAIN,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

# Grid status strings that indicate power outage
GRID_OFF_STATES = {"off-grid", "disconnected", "off_grid", "off"}

# Voltage threshold in volts — below this on all 3 phases = outage
VOLTAGE_OUTAGE_THRESHOLD = 50.0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Battery Guard binary sensor entities."""
    use_voltage = entry.data.get(CONF_USE_VOLTAGE, False)

    if use_voltage:
        async_add_entities(
            [
                PowerOutageVoltageSensor(
                    entry,
                    phase_a=entry.data[CONF_VOLTAGE_PHASE_A],
                    phase_b=entry.data[CONF_VOLTAGE_PHASE_B],
                    phase_c=entry.data[CONF_VOLTAGE_PHASE_C],
                )
            ]
        )
    else:
        grid_sensor = entry.data.get(CONF_GRID_SENSOR, "")
        if grid_sensor:
            async_add_entities([PowerOutageGridSensor(entry, grid_sensor)])
        else:
            _LOGGER.warning(
                "No grid sensor or voltage sensors configured — "
                "power outage detection will not be available"
            )


class PowerOutageGridSensor(BinarySensorEntity):
    """Power outage sensor using grid connection status entity."""

    _attr_has_entity_name = True
    _attr_name = "Power Outage"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_icon = "mdi:transmission-tower-off"

    def __init__(self, entry: ConfigEntry, grid_sensor: str) -> None:
        """Initialize the grid-based power outage sensor."""
        self._entry = entry
        self._grid_sensor = grid_sensor
        self._attr_unique_id = f"{entry.entry_id}_power_outage"
        self._attr_translation_key = "power_outage"
        self._attr_is_on = False

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
    def extra_state_attributes(self) -> dict:
        """Return extra attributes."""
        return {
            "detection_method": "grid_sensor",
            "source_entity": self._grid_sensor,
        }

    async def async_added_to_hass(self) -> None:
        """Subscribe to grid sensor state changes."""
        await super().async_added_to_hass()

        # Set initial state from current grid sensor value
        self._update_from_grid_state()

        # Listen for state changes
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._grid_sensor],
                self._handle_grid_state_change,
            )
        )

    @callback
    def _handle_grid_state_change(self, event: Event) -> None:
        """Handle grid sensor state change."""
        self._update_from_grid_state()
        self.async_write_ha_state()

    @callback
    def _update_from_grid_state(self) -> None:
        """Update outage state from grid sensor."""
        state = self.hass.states.get(self._grid_sensor)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._attr_is_on = False
            return
        self._attr_is_on = state.state.lower() in GRID_OFF_STATES


class PowerOutageVoltageSensor(BinarySensorEntity):
    """Power outage sensor using voltage monitoring (Shelly 3EM)."""

    _attr_has_entity_name = True
    _attr_name = "Power Outage"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_icon = "mdi:transmission-tower-off"

    def __init__(
        self,
        entry: ConfigEntry,
        phase_a: str,
        phase_b: str,
        phase_c: str,
    ) -> None:
        """Initialize the voltage-based power outage sensor."""
        self._entry = entry
        self._phase_sensors = [phase_a, phase_b, phase_c]
        self._attr_unique_id = f"{entry.entry_id}_power_outage"
        self._attr_translation_key = "power_outage"
        self._attr_is_on = False

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
    def extra_state_attributes(self) -> dict:
        """Return extra attributes."""
        voltages = {}
        for i, sensor_id in enumerate(self._phase_sensors):
            phase_label = chr(ord("A") + i)
            state = self.hass.states.get(sensor_id)
            if state and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                voltages[f"voltage_phase_{phase_label}"] = float(state.state)
            else:
                voltages[f"voltage_phase_{phase_label}"] = None
        return {
            "detection_method": "voltage_monitoring",
            "threshold_v": VOLTAGE_OUTAGE_THRESHOLD,
            **voltages,
        }

    async def async_added_to_hass(self) -> None:
        """Subscribe to voltage sensor state changes."""
        await super().async_added_to_hass()

        # Set initial state
        self._update_from_voltage_state()

        # Listen for state changes on all 3 phase sensors
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                self._phase_sensors,
                self._handle_voltage_state_change,
            )
        )

    @callback
    def _handle_voltage_state_change(self, event: Event) -> None:
        """Handle voltage sensor state change."""
        self._update_from_voltage_state()
        self.async_write_ha_state()

    @callback
    def _update_from_voltage_state(self) -> None:
        """Update outage state from voltage sensors.

        Power outage is detected when ALL 3 phases drop below the threshold.
        If a sensor is unavailable, we treat it as having normal voltage
        (safe default — avoid false outage detection).
        """
        all_below = True
        for sensor_id in self._phase_sensors:
            state = self.hass.states.get(sensor_id)
            if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                # Sensor unavailable — assume normal voltage (safe default)
                all_below = False
                break
            try:
                voltage = float(state.state)
            except (ValueError, TypeError):
                all_below = False
                break
            if voltage >= VOLTAGE_OUTAGE_THRESHOLD:
                all_below = False
                break

        self._attr_is_on = all_below
