"""Grid-status classification for Battery Guard.

Pure helpers (no Home Assistant imports) that decide whether a grid-status
string indicates the system is OFF-GRID (a power outage).

Safety principle: a connection/communication loss must NEVER be read as
off-grid — otherwise Battery Guard would shed load for nothing. Matching is
therefore an EXACT (normalized) membership test against a curated allow-list of
positive off-grid values, never a substring search: substrings are unsafe here
because "off-grid" also appears in config labels ("Off-grid switch disabled")
and "disconnected" appears in the comms-loss status "Shutdown: communication
disconnected".
"""

from __future__ import annotations

# Normalized (strip + lowercase) status values that POSITIVELY indicate off-grid.
GRID_OFF_STATES: frozenset[str] = frozenset(
    {
        # Generic off-grid spellings
        "off-grid",
        "off_grid",
        "offgrid",
        # Real Huawei DEVICE_STATUS / grid-status off-grid values
        "off-grid mode: running",
        "running: off-grid charging",
    }
)


def state_indicates_outage(raw: str | None) -> bool:
    """Return True only for a positive, unambiguous off-grid status.

    Fails safe: anything else — including empty/None, communication-fault
    strings, off-grid *switch* config labels, or a plain binary ``off`` — is
    treated as NOT an outage.
    """
    return (raw or "").strip().lower() in GRID_OFF_STATES
