# ADR-003: Use HA Labels for Device Tier Assignment

## Status

Accepted

## Context

The automation system needs to dynamically determine which devices belong to which priority tier at runtime. Hardcoding entity IDs in automations is brittle -- adding or removing a device requires editing YAML. A mechanism is needed that:

1. Allows grouping entities by tier.
2. Can be queried dynamically in automations and scripts.
3. Is manageable through both the HA UI and the WebSocket API.
4. Supports the wizard assigning tiers programmatically.

## Decision

Use Home Assistant's native **label system** (introduced in HA 2024.2) with the following labels:

| Label | Purpose |
|-------|---------|
| `battery_guard_tier1` | Immediate shutdown on outage |
| `battery_guard_tier2` | Shutdown at low SOC |
| `battery_guard_tier3` | Never shut down |
| `battery_guard_ignore` | Excluded from monitoring |

Automations and scripts use the `label_entities()` template function to resolve entity lists at runtime:

```yaml
action:
  - service: homeassistant.turn_off
    target:
      entity_id: "{{ label_entities('battery_guard_tier1') }}"
```

This means the automation YAML is static -- only the label assignments change when devices are added, removed, or re-tiered.

## Alternatives Considered

- **Entity groups (`group.battery_guard_tier1`):** Groups are static YAML definitions. Adding a device requires editing `groups.yaml` and reloading. Not manageable via WebSocket API. Rejected.
- **Input select helpers:** A single `input_select` per entity does not scale to dozens of devices and creates excessive helper entities. Rejected.
- **Custom attributes on entities:** HA does not support arbitrary custom attributes on the entity registry. Would require a custom integration. Rejected.
- **Area-based grouping:** Areas serve a different semantic purpose (physical location). Overloading areas for priority tiers would conflict with their intended use. Rejected.

## Consequences

- Requires Home Assistant 2024.2 or later (label support).
- Labels are first-class HA objects: visible in the UI, manageable via Settings > Labels, and accessible through the WebSocket API (`config/label_registry/*`, `config/entity_registry/update`).
- Adding a new device to the system requires only assigning it a label -- no automation changes needed.
- The wizard can programmatically assign labels via `config/entity_registry/update`, with merge logic to preserve non-battery-guard labels on each entity.
- The `label_entities()` function is evaluated at automation runtime, so tier membership is always current.
