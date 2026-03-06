"""Service implementations for Battery Guard."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_NOTIFY_SERVICES,
    DOMAIN,
    LABEL_TIER1,
    LABEL_TIER2,
)

_LOGGER = logging.getLogger(__name__)

# Domains that should NOT be auto-restored (high inrush current, manual restart needed)
RESTORE_EXCLUDE_DOMAINS = {"climate", "media_player"}

SERVICE_TIER_OFF = "tier_off"
SERVICE_TIER_ON = "tier_on"
SERVICE_RESTORE_ALL = "restore_all"
SERVICE_NOTIFY = "notify"

VALID_TIERS = {LABEL_TIER1, LABEL_TIER2}


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register Battery Guard services."""

    async def handle_tier_off(call: ServiceCall) -> None:
        """Turn off all devices in a tier."""
        tier = call.data["tier"]
        if tier not in VALID_TIERS:
            _LOGGER.error("Invalid tier: %s", tier)
            return

        registry = er.async_get(hass)
        entities = er.async_entries_for_label(registry, tier)
        entity_ids = [e.entity_id for e in entities if not e.disabled_by]

        if not entity_ids:
            _LOGGER.info("No entities found for tier %s", tier)
            return

        _LOGGER.info("Turning off %d entities in %s", len(entity_ids), tier)
        await hass.services.async_call(
            "homeassistant",
            "turn_off",
            {},
            target={"entity_id": entity_ids},
            blocking=True,
        )

    async def handle_tier_on(call: ServiceCall) -> None:
        """Restore devices in a tier (exclude climate/media_player)."""
        tier = call.data["tier"]
        if tier not in VALID_TIERS:
            _LOGGER.error("Invalid tier: %s", tier)
            return

        registry = er.async_get(hass)
        entities = er.async_entries_for_label(registry, tier)
        entity_ids = [
            e.entity_id
            for e in entities
            if not e.disabled_by
            and e.entity_id.split(".")[0] not in RESTORE_EXCLUDE_DOMAINS
        ]

        if not entity_ids:
            _LOGGER.info("No restorable entities found for tier %s", tier)
            return

        _LOGGER.info("Restoring %d entities in %s", len(entity_ids), tier)
        await hass.services.async_call(
            "homeassistant",
            "turn_on",
            {},
            target={"entity_id": entity_ids},
            blocking=True,
        )

    async def handle_restore_all(call: ServiceCall) -> None:
        """Full reset: restore both tiers and clear status flags."""
        _LOGGER.info("Executing full Battery Guard reset")

        # Restore tier 1
        await hass.services.async_call(
            DOMAIN,
            SERVICE_TIER_ON,
            {"tier": LABEL_TIER1},
            blocking=True,
        )

        # Restore tier 2
        await hass.services.async_call(
            DOMAIN,
            SERVICE_TIER_ON,
            {"tier": LABEL_TIER2},
            blocking=True,
        )

        # Reset status switches
        # Find our switch entities by looking for them in the entity registry
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
                _LOGGER.exception("Failed to send notification via %s", service_target)

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
