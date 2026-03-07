"""Service implementations for Battery Guard.

v2.0.0: Per-device graduated actions with state save/restore.
Each entity can have a different action per tier (e.g., climate → fan_only
in Tier 1, turn_off in Tier 2). Before any action, the device's current
state is captured so it can be fully restored when grid power returns.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_DEVICE_ACTIONS,
    CONF_NOTIFY_SERVICES,
    CONF_RESTORE_CONFIG,
    DEFAULT_RESTORE_CONFIG,
    DOMAIN,
    LABEL_TIER1,
    LABEL_TIER2,
    LABEL_TIER3,
    TIER_KEY_TO_LABEL,
)
from .labels import resolve_label_id
from .state_store import StateStore, execute_action, restore_state

_LOGGER = logging.getLogger(__name__)

SERVICE_TIER_OFF = "tier_off"
SERVICE_TIER_ON = "tier_on"
SERVICE_RESTORE_ALL = "restore_all"
SERVICE_NOTIFY = "notify"

VALID_TIERS = {LABEL_TIER1, LABEL_TIER2, LABEL_TIER3}

# Map logical tier keys to the key used in device_actions config
_TIER_ACTION_KEY = {
    LABEL_TIER1: "tier1",
    LABEL_TIER2: "tier2",
    LABEL_TIER3: "tier3",
}


def _get_state_store(hass: HomeAssistant) -> StateStore | None:
    """Get the StateStore from hass.data, if available."""
    return hass.data.get(DOMAIN, {}).get("state_store")


def _get_device_actions(entry: ConfigEntry) -> dict[str, Any]:
    """Get device_actions from config entry options."""
    return entry.options.get(CONF_DEVICE_ACTIONS, {})


def _get_restore_config(entry: ConfigEntry) -> dict[str, Any]:
    """Get restore_config from config entry options."""
    return entry.options.get(CONF_RESTORE_CONFIG, DEFAULT_RESTORE_CONFIG)


def _get_action_config(
    device_actions: dict[str, Any], entity_id: str, tier_key: str
) -> dict[str, Any]:
    """Get the action config for an entity in a specific tier.

    Returns the configured action, or a default turn_off action
    if no specific action is configured.
    """
    entity_config = device_actions.get(entity_id, {})
    action_config = entity_config.get(tier_key)

    if action_config and isinstance(action_config, dict) and "action" in action_config:
        return action_config

    # Default: turn_off (backward compatibility)
    return {"action": "turn_off"}


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register Battery Guard services."""

    async def handle_tier_off(call: ServiceCall) -> None:
        """Turn off / adjust all devices in a tier.

        For each entity:
        1. Save current state (first-save-wins via StateStore)
        2. Look up per-device action from config entry options
        3. Execute the configured action (set_hvac_mode, dim, turn_off, etc.)
        """
        tier = call.data["tier"]
        if tier not in VALID_TIERS:
            _LOGGER.error("Invalid tier: %s", tier)
            return

        actual_label_id = resolve_label_id(hass, tier)
        if not actual_label_id:
            _LOGGER.error("Cannot resolve label ID for tier: %s", tier)
            return

        registry = er.async_get(hass)
        entities = er.async_entries_for_label(registry, actual_label_id)
        entity_ids = [e.entity_id for e in entities if not e.disabled_by]

        if not entity_ids:
            _LOGGER.info("No entities found for tier %s", tier)
            return

        tier_key = _TIER_ACTION_KEY.get(tier, "tier1")
        device_actions = _get_device_actions(entry)
        state_store = _get_state_store(hass)

        _LOGGER.info(
            "Executing tier %s actions for %d entities", tier, len(entity_ids)
        )

        for entity_id in entity_ids:
            # 1. Save state before any action
            if state_store:
                state_store.save_state(entity_id)

            # 2. Get the configured action for this entity + tier
            action_config = _get_action_config(device_actions, entity_id, tier_key)

            # 3. Execute the action
            try:
                await execute_action(hass, entity_id, action_config)
                _LOGGER.debug(
                    "Executed %s on %s", action_config.get("action"), entity_id
                )
            except Exception:
                _LOGGER.exception(
                    "Failed to execute action on %s: %s", entity_id, action_config
                )

    async def handle_tier_on(call: ServiceCall) -> None:
        """Restore devices in a tier to their saved state.

        Respects restore_config: skips stay_off entities and applies
        device_delay between individual restores.
        """
        tier = call.data["tier"]
        if tier not in VALID_TIERS:
            _LOGGER.error("Invalid tier: %s", tier)
            return

        actual_label_id = resolve_label_id(hass, tier)
        if not actual_label_id:
            _LOGGER.error("Cannot resolve label ID for tier: %s", tier)
            return

        registry = er.async_get(hass)
        entities = er.async_entries_for_label(registry, actual_label_id)

        # Filter out disabled and stay_off entities
        restore_config = _get_restore_config(entry)
        stay_off_list: list[str] = restore_config.get("stay_off", [])
        entity_ids = [
            e.entity_id
            for e in entities
            if not e.disabled_by and e.entity_id not in stay_off_list
        ]

        if not entity_ids:
            _LOGGER.info("No restorable entities found for tier %s", tier)
            return

        # Get device delay for this tier
        tier_key = _TIER_ACTION_KEY.get(tier, "tier1")
        device_delay = (
            restore_config.get("tier_delays", {})
            .get(tier_key, {})
            .get("device_delay", 0)
        )

        state_store = _get_state_store(hass)

        _LOGGER.info(
            "Restoring %d entities in %s (device_delay=%ds)",
            len(entity_ids),
            tier,
            device_delay,
        )

        for i, entity_id in enumerate(entity_ids):
            try:
                saved = (
                    state_store.get_saved_state(entity_id) if state_store else None
                )

                if saved:
                    await restore_state(hass, entity_id, saved)
                    if state_store:
                        state_store.clear_state(entity_id)
                    _LOGGER.debug("Restored %s from saved state", entity_id)
                else:
                    # No saved state — generic turn_on (best effort)
                    await hass.services.async_call(
                        "homeassistant",
                        "turn_on",
                        {},
                        target={"entity_id": entity_id},
                        blocking=True,
                    )
                    _LOGGER.debug(
                        "No saved state for %s — generic turn_on", entity_id
                    )
            except Exception:
                _LOGGER.exception("Failed to restore %s", entity_id)

            # Delay between devices (not after the last one)
            if device_delay > 0 and i < len(entity_ids) - 1:
                await asyncio.sleep(device_delay)

    async def handle_restore_all(call: ServiceCall) -> None:
        """Staged restore: restore tiers in configured order with delays."""
        _LOGGER.info("Executing staged Battery Guard restore")

        restore_config = _get_restore_config(entry)
        restore_order: list[str] = restore_config.get(
            "restore_order", ["tier3", "tier2", "tier1"]
        )
        tier_delays_config: dict[str, Any] = restore_config.get("tier_delays", {})
        stay_off_list: list[str] = restore_config.get("stay_off", [])

        for i, tier_key in enumerate(restore_order):
            label_key = TIER_KEY_TO_LABEL.get(tier_key)
            if not label_key:
                _LOGGER.warning("Unknown tier key in restore_order: %s", tier_key)
                continue

            # Wait before restoring this tier (skip delay for first tier)
            tier_delay = tier_delays_config.get(tier_key, {}).get("tier_delay", 0)
            if tier_delay > 0 and i > 0:
                _LOGGER.info(
                    "Waiting %ds before restoring %s", tier_delay, tier_key
                )
                await asyncio.sleep(tier_delay)

            _LOGGER.info("Restoring tier: %s", tier_key)
            await hass.services.async_call(
                DOMAIN,
                SERVICE_TIER_ON,
                {"tier": label_key},
                blocking=True,
            )

        # Clear saved states for stay_off entities (prevent stale data)
        state_store = _get_state_store(hass)
        if state_store:
            for entity_id in stay_off_list:
                state_store.clear_state(entity_id)
            state_store.clear_all()

        # Reset status switches
        registry = er.async_get(hass)
        for suffix in ("active", "tier2_disabled"):
            for ent in registry.entities.values():
                if (
                    ent.platform == DOMAIN
                    and ent.unique_id
                    and ent.unique_id.endswith(f"_{suffix}")
                ):
                    await hass.services.async_call(
                        "switch",
                        "turn_off",
                        {},
                        target={"entity_id": ent.entity_id},
                        blocking=True,
                    )
                    break

    async def handle_notify(call: ServiceCall) -> None:
        """Send notification through configured channels."""
        title = call.data["title"]
        message = call.data["message"]
        critical = call.data.get("critical", False)

        # Find the config entry to get notify services
        notify_services: list[str] = []
        for eid, data in hass.data.get(DOMAIN, {}).items():
            if isinstance(data, dict) and "config" in data:
                notify_services = data["config"].get(CONF_NOTIFY_SERVICES, [])
                break

        # Send to each configured notify service
        for service_target in notify_services:
            # service_target is like "notify.mobile_app_xxx"
            parts = service_target.split(".", 1)
            if len(parts) != 2 or parts[0] != "notify":
                _LOGGER.warning("Invalid notify service: %s", service_target)
                continue

            service_data: dict[str, Any] = {
                "title": title,
                "message": message,
            }

            # Add critical push data for mobile apps
            if critical:
                service_data["data"] = {
                    "push": {"interruption-level": "critical"},
                }

            try:
                await hass.services.async_call(
                    "notify",
                    parts[1],
                    service_data,
                    blocking=True,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed to send notification via %s", service_target
                )

        # Always send persistent notification in HA UI
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": title,
                "message": message,
                "notification_id": f"battery_guard_{hash(title) & 0xFFFFFFFF}",
            },
            blocking=True,
        )

    # Register all services
    hass.services.async_register(
        DOMAIN,
        SERVICE_TIER_OFF,
        handle_tier_off,
        schema=vol.Schema({vol.Required("tier"): vol.In(VALID_TIERS)}),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_TIER_ON,
        handle_tier_on,
        schema=vol.Schema({vol.Required("tier"): vol.In(VALID_TIERS)}),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESTORE_ALL,
        handle_restore_all,
        schema=vol.Schema({}),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_NOTIFY,
        handle_notify,
        schema=vol.Schema(
            {
                vol.Required("title"): str,
                vol.Required("message"): str,
                vol.Optional("critical", default=False): bool,
            }
        ),
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unregister Battery Guard services."""
    # Only unregister if no more config entries exist
    if hass.data.get(DOMAIN):
        return

    for service in (
        SERVICE_TIER_OFF,
        SERVICE_TIER_ON,
        SERVICE_RESTORE_ALL,
        SERVICE_NOTIFY,
    ):
        hass.services.async_remove(DOMAIN, service)
