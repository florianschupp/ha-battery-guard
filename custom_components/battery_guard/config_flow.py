"""Config flow for Battery Guard integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_SOC_SENSOR,
    CONF_GRID_SENSOR,
    CONF_USE_VOLTAGE,
    CONF_VOLTAGE_PHASE_A,
    CONF_VOLTAGE_PHASE_B,
    CONF_VOLTAGE_PHASE_C,
    CONF_TIER2_THRESHOLD,
    CONF_RECOVERY_THRESHOLD,
    CONF_CRITICAL_SOC,
    CONF_NOTIFY_SERVICES,
    DEFAULT_TIER2_THRESHOLD,
    DEFAULT_TIER2_RECOVERY_THRESHOLD,
    DEFAULT_CRITICAL_SOC,
)

_LOGGER = logging.getLogger(__name__)


class BatteryGuardConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Battery Guard.

    The config flow only asks for thresholds and notifications.
    Sensors (SOC, grid, voltage) are configured via the Options flow
    so the integration can be installed before Modbus is set up.
    """

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self.data: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: SOC thresholds."""
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input[CONF_RECOVERY_THRESHOLD] <= user_input[CONF_TIER2_THRESHOLD]:
                errors[CONF_RECOVERY_THRESHOLD] = "recovery_must_exceed_threshold"
            else:
                self.data.update(user_input)
                return await self.async_step_notifications()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_TIER2_THRESHOLD, default=DEFAULT_TIER2_THRESHOLD
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=10,
                            max=90,
                            step=5,
                            unit_of_measurement="%",
                            mode=selector.NumberSelectorMode.SLIDER,
                        )
                    ),
                    vol.Required(
                        CONF_RECOVERY_THRESHOLD,
                        default=DEFAULT_TIER2_RECOVERY_THRESHOLD,
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=10,
                            max=90,
                            step=5,
                            unit_of_measurement="%",
                            mode=selector.NumberSelectorMode.SLIDER,
                        )
                    ),
                    vol.Required(
                        CONF_CRITICAL_SOC, default=DEFAULT_CRITICAL_SOC
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=5,
                            max=30,
                            step=1,
                            unit_of_measurement="%",
                        )
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_notifications(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2: Notification services."""
        if user_input is not None:
            self.data[CONF_NOTIFY_SERVICES] = user_input.get(CONF_NOTIFY_SERVICES, [])
            # Initialize sensor fields as empty (configured via Options)
            self.data.setdefault(CONF_SOC_SENSOR, "")
            self.data.setdefault(CONF_GRID_SENSOR, "")
            self.data.setdefault(CONF_USE_VOLTAGE, False)
            return self.async_create_entry(
                title="Battery Guard",
                data=self.data,
            )

        # Build list of available notify services
        services = self.hass.services.async_services().get("notify", {})
        options = [
            selector.SelectOptionDict(value=f"notify.{svc}", label=svc)
            for svc in services
        ]

        return self.async_show_form(
            step_id="notifications",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_NOTIFY_SERVICES): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            multiple=True,
                        )
                    ),
                }
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry,
    ) -> BatteryGuardOptionsFlow:
        """Return the options flow handler."""
        return BatteryGuardOptionsFlow(config_entry)


class BatteryGuardOptionsFlow(OptionsFlow):
    """Handle options flow for Battery Guard.

    Allows configuring sensors, thresholds, and notifications after setup.
    This is where SOC sensor, grid sensor, and voltage monitoring are added
    once the PV system is integrated via Modbus.
    Sensor changes trigger an integration reload to pick up the new entities.
    """

    def __init__(self, config_entry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry
        self._data: dict[str, Any] = {}

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: Sensors — SOC + grid detection method."""
        if user_input is not None:
            self._data[CONF_SOC_SENSOR] = user_input.get(CONF_SOC_SENSOR, "")
            self._data[CONF_GRID_SENSOR] = user_input.get(CONF_GRID_SENSOR, "")
            self._data[CONF_USE_VOLTAGE] = user_input.get(CONF_USE_VOLTAGE, False)
            if self._data[CONF_USE_VOLTAGE]:
                return await self.async_step_voltage()
            return await self.async_step_thresholds()

        current = self.config_entry.data

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_SOC_SENSOR,
                        description={
                            "suggested_value": current.get(CONF_SOC_SENSOR, "")
                        },
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(
                        CONF_GRID_SENSOR,
                        description={
                            "suggested_value": current.get(CONF_GRID_SENSOR, "")
                        },
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(
                        CONF_USE_VOLTAGE,
                        default=current.get(CONF_USE_VOLTAGE, False),
                    ): bool,
                }
            ),
        )

    async def async_step_voltage(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1b: Voltage monitoring sensors (Shelly 3EM)."""
        if user_input is not None:
            self._data[CONF_VOLTAGE_PHASE_A] = user_input[CONF_VOLTAGE_PHASE_A]
            self._data[CONF_VOLTAGE_PHASE_B] = user_input[CONF_VOLTAGE_PHASE_B]
            self._data[CONF_VOLTAGE_PHASE_C] = user_input[CONF_VOLTAGE_PHASE_C]
            return await self.async_step_thresholds()

        current = self.config_entry.data

        return self.async_show_form(
            step_id="voltage",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_VOLTAGE_PHASE_A,
                        default=current.get(CONF_VOLTAGE_PHASE_A, ""),
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Required(
                        CONF_VOLTAGE_PHASE_B,
                        default=current.get(CONF_VOLTAGE_PHASE_B, ""),
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Required(
                        CONF_VOLTAGE_PHASE_C,
                        default=current.get(CONF_VOLTAGE_PHASE_C, ""),
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                }
            ),
        )

    async def async_step_thresholds(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2: Thresholds + notifications."""
        errors: dict[str, str] = {}
        if user_input is not None:
            recovery = user_input.get(
                CONF_RECOVERY_THRESHOLD, DEFAULT_TIER2_RECOVERY_THRESHOLD
            )
            threshold = user_input.get(CONF_TIER2_THRESHOLD, DEFAULT_TIER2_THRESHOLD)
            if recovery <= threshold:
                errors[CONF_RECOVERY_THRESHOLD] = "recovery_must_exceed_threshold"
            else:
                self._data.update(user_input)
                # Merge with existing config data
                new_data = {**self.config_entry.data, **self._data}
                # Normalize empty sensor strings
                for key in (CONF_SOC_SENSOR, CONF_GRID_SENSOR):
                    if not new_data.get(key):
                        new_data[key] = ""
                self.hass.config_entries.async_update_entry(
                    self.config_entry, data=new_data
                )
                await self.hass.config_entries.async_reload(self.config_entry.entry_id)
                return self.async_create_entry(title="", data={})

        current = self.config_entry.data

        # Build notify service options
        services = self.hass.services.async_services().get("notify", {})
        notify_options = [
            selector.SelectOptionDict(value=f"notify.{svc}", label=svc)
            for svc in services
        ]

        return self.async_show_form(
            step_id="thresholds",
            data_schema=vol.Schema(
                {
                    # --- Thresholds ---
                    vol.Required(
                        CONF_TIER2_THRESHOLD,
                        default=current.get(
                            CONF_TIER2_THRESHOLD, DEFAULT_TIER2_THRESHOLD
                        ),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=10,
                            max=90,
                            step=5,
                            unit_of_measurement="%",
                            mode=selector.NumberSelectorMode.SLIDER,
                        )
                    ),
                    vol.Required(
                        CONF_RECOVERY_THRESHOLD,
                        default=current.get(
                            CONF_RECOVERY_THRESHOLD,
                            DEFAULT_TIER2_RECOVERY_THRESHOLD,
                        ),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=10,
                            max=90,
                            step=5,
                            unit_of_measurement="%",
                            mode=selector.NumberSelectorMode.SLIDER,
                        )
                    ),
                    vol.Required(
                        CONF_CRITICAL_SOC,
                        default=current.get(CONF_CRITICAL_SOC, DEFAULT_CRITICAL_SOC),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=5,
                            max=30,
                            step=1,
                            unit_of_measurement="%",
                        )
                    ),
                    # --- Notifications ---
                    vol.Optional(
                        CONF_NOTIFY_SERVICES,
                        description={
                            "suggested_value": current.get(CONF_NOTIFY_SERVICES, [])
                        },
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=notify_options,
                            multiple=True,
                        )
                    ),
                }
            ),
            errors=errors,
        )
