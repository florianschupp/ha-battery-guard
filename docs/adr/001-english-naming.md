# ADR-001: Use English for All Code, Labels, and Documentation

## Status

Accepted

## Context

The project originally started with German naming conventions for labels, entity IDs, and inline comments. As the project grew to serve multiple installations and gained potential for public sharing, inconsistent language became a maintenance burden. German labels like `notstrom_sofort_aus` are unintelligible to contributors or tools outside the German-speaking context.

A consistent language standard was needed to support collaboration, public release, and integration with English-language HA documentation and APIs.

## Decision

All project artifacts use English exclusively:

- **Labels:** Prefixed with `battery_guard_` (e.g., `battery_guard_tier1`, `battery_guard_tier2`, `battery_guard_tier3`, `battery_guard_ignore`).
- **Entity IDs:** Prefixed with `battery_guard_` (e.g., `input_number.battery_guard_soc_threshold`).
- **Code:** All variable names, function names, and inline comments in English.
- **Documentation:** All docs, ADRs, and README files in English.
- **Git:** Commit messages and PR descriptions in English.

## Alternatives Considered

- **Keep German naming:** Rejected because it limits the audience and complicates public sharing.
- **Bilingual approach:** Rejected due to inconsistency risk and doubled maintenance effort.

## Consequences

- Existing German YAML packages and labels require migration.
- The setup wizard includes migration logic to detect and replace legacy German labels (e.g., `notstrom_sofort_aus` to `battery_guard_tier1`).
- All future contributions must follow the English naming convention.
