"""Panel registration for Battery Guard wizard."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "/battery-guard"
PANEL_TITLE = "Battery Guard"
PANEL_ICON = "mdi:battery-heart"
PANEL_COMPONENT = "iframe"

# Static path for serving the React SPA
STATIC_PATH = "/api/panel_custom/battery_guard"
FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the Battery Guard panel and static file serving."""
    if not FRONTEND_DIR.is_dir():
        _LOGGER.warning(
            "Frontend directory not found at %s — panel will not be available",
            FRONTEND_DIR,
        )
        return

    # Register static path to serve frontend files
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                url_path=STATIC_PATH,
                path=str(FRONTEND_DIR),
                cache_headers=True,
            )
        ]
    )

    # Register the panel as an iframe panel
    async_register_built_in_panel(
        hass,
        component_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=DOMAIN,
        config={"url": f"{STATIC_PATH}/index.html"},
        require_admin=False,
    )

    _LOGGER.info("Battery Guard panel registered")


async def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the Battery Guard panel."""
    async_remove_panel(hass, DOMAIN)
    _LOGGER.info("Battery Guard panel unregistered")
