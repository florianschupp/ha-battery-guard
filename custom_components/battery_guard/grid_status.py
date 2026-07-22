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


# ---------------------------------------------------------------------------
# 3-state classification (#70)
#
# Detection (above) may only ever answer "is this positively off-grid?", because
# a comms loss must never cause shedding. Deciding to RESTORE needs the opposite
# guarantee: a positively confirmed ON-grid reading. "Not off-grid" is NOT good
# enough there — an unrecognised value or a dead source would otherwise be read
# as "grid is back" and switch every shed load on mid-outage.
# ---------------------------------------------------------------------------

GRID_ON = "on"
GRID_OFF = "off"
GRID_UNKNOWN = "unknown"

# Normalized values that POSITIVELY indicate on-grid. A bare "on" is
# deliberately NOT included: the configured source may be a binary_sensor or
# input_boolean, where "on" is as likely to mean "outage present" as "grid
# present" — admitting it could invert the meaning.
GRID_ON_STATES: frozenset[str] = frozenset(
    {
        "on-grid",
        "on_grid",
        "ongrid",
        "on grid",
        "grid connected",
    }
)

_UNKNOWN_RAW: frozenset[str] = frozenset({"", "unavailable", "unknown"})


def classify_grid_status(raw: str | None) -> str:
    """Classify a grid-status sensor value as ON / OFF / UNKNOWN.

    Anything that is neither a recognised off-grid nor a recognised on-grid
    value is UNKNOWN — never ON. That is the whole point: restoring requires a
    positive confirmation, not the absence of an outage signal.
    """
    if raw is None:
        return GRID_UNKNOWN
    normalized = raw.strip().lower()
    if normalized in _UNKNOWN_RAW:
        return GRID_UNKNOWN
    if normalized in GRID_OFF_STATES:
        return GRID_OFF
    if normalized in GRID_ON_STATES:
        return GRID_ON
    return GRID_UNKNOWN


def classify_grid_voltage(raw_phases: list[str | None], threshold: float) -> str:
    """Classify the three phase voltages as ON / OFF / UNKNOWN.

    ON requires **all** phases to be readable and above the threshold — a
    positive measurement, symmetric to ``classify_grid_status``. A mixed result
    (some above, some below) is UNKNOWN, which also means a single-phase outage
    can never authorise a restore.

    Empty input is UNKNOWN rather than falling into the ``all([])`` vacuum
    truth, which would otherwise read as OFF.
    """
    if not raw_phases:
        return GRID_UNKNOWN

    voltages: list[float] = []
    for raw in raw_phases:
        if raw is None:
            return GRID_UNKNOWN
        if raw.strip().lower() in _UNKNOWN_RAW:
            return GRID_UNKNOWN
        try:
            voltages.append(float(raw))
        except (ValueError, TypeError):
            return GRID_UNKNOWN

    if all(v < threshold for v in voltages):
        return GRID_OFF
    if all(v >= threshold for v in voltages):
        return GRID_ON
    return GRID_UNKNOWN
