"""Tests for the pure grid-status off-grid matcher (#51 Part A)."""

from __future__ import annotations

import pytest

from custom_components.battery_guard.grid_status import state_indicates_outage


@pytest.mark.parametrize(
    "value",
    [
        "off-grid",
        "Off-Grid",
        "OFF-GRID",
        "  off-grid  ",
        "off_grid",
        "offgrid",
        "Off-grid mode: running",
        "Running: off-grid charging",
    ],
)
def test_off_grid_values_are_outage(value):
    assert state_indicates_outage(value) is True


@pytest.mark.parametrize(
    "value",
    [
        # Safety: a communication / connection loss must NEVER read as off-grid.
        "Shutdown: communication disconnected",
        "disconnected",
        "Meter disconnected",
        # Off-grid *switch* config labels are NOT a live outage.
        "Off-grid switch disabled",
        "Off-grid switch enabled",
        # Normal on-grid / idle states.
        "On-grid",
        "Grid-connected normally",
        "Standby",
        # A plain binary_sensor "off" means healthy, not an outage.
        "off",
        # Substrings of "off" must not match.
        "standoff",
        "shutoff",
        # Ambiguous / unrelated.
        "backup mode",
        # Empty / missing.
        "",
        "   ",
        None,
    ],
)
def test_non_off_grid_values_are_not_outage(value):
    assert state_indicates_outage(value) is False
