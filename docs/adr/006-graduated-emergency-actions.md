# ADR 006: Graduated Emergency Actions

## Status
Accepted

## Date
2026-03-07

## Context

Battery Guard v1.x uses a simple model: devices in a tier are either turned off (tier_off) or turned back on (tier_on). This works for switches but is suboptimal for climate and light devices.

Real-world use case: During a power outage, an air conditioner should first switch to fan-only mode (Tier 1) to reduce consumption while maintaining air circulation, and only turn off completely when battery drops critically low (Tier 2).

This requires:
1. Per-device, per-tier action configuration
2. Domain-aware actions (climate supports set_hvac_mode, light supports dimming)
3. State capture before any action, so devices can be fully restored
4. An entity can be in multiple tiers with different actions

## Decision

### Data Model

Per-device actions are stored in the config entry options under `device_actions`:

```json
{
  "climate.living_room": {
    "tier1": { "action": "set_hvac_mode", "hvac_mode": "fan_only" },
    "tier2": { "action": "turn_off" }
  },
  "light.kitchen": {
    "tier1": { "action": "dim", "brightness_pct": 20 }
  }
}
```

Entities without explicit `device_actions` fall back to `turn_off` (backward compatible).

### State Store

`StateStore` is an in-memory store that captures device state before any action. It follows a first-save-wins rule: if an entity's state was saved during Tier 1, the Tier 2 action won't overwrite it. This ensures the original (pre-outage) state is preserved for restoration.

Domain-specific attributes are saved:
- Climate: hvac_mode, temperature, fan_mode, preset_mode, etc.
- Light: brightness, color_temp, hs_color, rgb_color, etc.
- Media player: volume_level, source

### Multi-Label Tier Assignment

An entity can have multiple Battery Guard labels simultaneously (e.g., `battery_guard_tier1` AND `battery_guard_tier2`). The HA entity registry supports multiple labels per entity. The automation engine's `tier_off` handler picks up all entities for a tier via `async_entries_for_label`, so multi-tier entities are naturally included.

T3 (never off) and Ignore are mutually exclusive with T1/T2.

### WebSocket API

Two custom WebSocket commands enable the wizard to read/write device actions:
- `battery_guard/get_device_actions` — read from config entry options
- `battery_guard/set_device_actions` — write to config entry options

### Config Flow Migration

Config flow VERSION bumps from 1 to 2. `async_migrate_entry` initializes empty `device_actions` in options for existing installations.

## Consequences

### Positive
- Climate devices can have graduated response (fan mode → off)
- Lights can dim before turning off
- Full state restoration preserves user comfort settings
- Backward compatible: existing installations keep working without reconfiguration

### Negative
- More complex data model than simple on/off
- In-memory state store is lost on HA restart (acceptable: if HA restarts during outage, state was already lost)
- Multi-label assignments increase complexity in the wizard UI

## Alternatives Considered

1. **Separate "action" field per label**: Store action in the label description. Rejected: labels are shared across entities and don't support per-entity configuration.

2. **Custom YAML configuration**: Let users define actions in YAML. Rejected: the wizard provides a much better UX for 40+ devices.

3. **Persistent state store**: Save state to disk for survival across HA restarts. Deferred: the outage scenario (power loss → HA restart) inherently means state was already lost. Can be added later if needed.
