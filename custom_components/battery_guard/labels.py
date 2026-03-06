"""Label management for Battery Guard."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers import label_registry as lr

from .const import DOMAIN, LABEL_DEFINITIONS

_LOGGER = logging.getLogger(__name__)


def _find_label_by_name(
    label_reg: lr.LabelRegistry, name: str
) -> lr.LabelEntry | None:
    """Find a label by its display name."""
    for label in label_reg.labels.values():
        if label.name == name:
            return label
    return None


async def async_ensure_labels(hass: HomeAssistant) -> dict[str, str]:
    """Ensure all Battery Guard labels exist.

    Returns a mapping of {logical_key: actual_ha_label_id}.
    HA generates label IDs from the name (e.g. "Battery Guard: Tier 1"
    may become "battery_guard_tier_1"), so we always search by name
    and store the actual IDs at runtime.
    """
    label_reg = lr.async_get(hass)
    label_map: dict[str, str] = {}

    for logical_key, definition in LABEL_DEFINITIONS.items():
        label_name = definition["name"]

        existing = _find_label_by_name(label_reg, label_name)

        if existing is not None:
            label_map[logical_key] = existing.label_id
            _LOGGER.debug(
                "Label exists: %s -> %s", logical_key, existing.label_id
            )
        else:
            _LOGGER.info("Creating label: %s", label_name)
            try:
                new_label = label_reg.async_create(
                    name=label_name,
                    color=definition.get("color"),
                    icon=definition.get("icon"),
                    description=definition.get("description"),
                )
                label_map[logical_key] = new_label.label_id
            except ValueError:
                # Label was created between our check and create (race condition)
                found = _find_label_by_name(label_reg, label_name)
                if found:
                    label_map[logical_key] = found.label_id
                else:
                    _LOGGER.error(
                        "Failed to create or find label: %s", label_name
                    )

    return label_map


def get_label_map(hass: HomeAssistant) -> dict[str, str]:
    """Get the label mapping {logical_key: actual_label_id} from hass data."""
    return hass.data.get(DOMAIN, {}).get("label_map", {})


def resolve_label_id(hass: HomeAssistant, logical_key: str) -> str | None:
    """Resolve a logical label key to the actual HA label ID."""
    return get_label_map(hass).get(logical_key)
