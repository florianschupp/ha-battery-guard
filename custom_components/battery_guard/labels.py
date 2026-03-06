"""Label management for Battery Guard."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers import label_registry as lr

from .const import LABEL_DEFINITIONS

_LOGGER = logging.getLogger(__name__)


async def async_ensure_labels(hass: HomeAssistant) -> None:
    """Ensure all Battery Guard labels exist, create missing ones."""
    label_reg = lr.async_get(hass)

    for label_id, definition in LABEL_DEFINITIONS.items():
        existing = label_reg.async_get_label(label_id)
        if existing is None:
            _LOGGER.info("Creating label: %s", label_id)
            label_reg.async_create(
                name=definition["name"],
                color=definition.get("color"),
                icon=definition.get("icon"),
                description=definition.get("description"),
            )
        else:
            _LOGGER.debug("Label already exists: %s", label_id)
