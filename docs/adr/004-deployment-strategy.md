# ADR-004: ZIP Release with Manual File Copy

## Status

Accepted

## Context

HA Battery Guard needs to be deployed across 3 independent Home Assistant installations. The deployment must be reproducible and simple enough for non-technical users to perform with minimal guidance. The project consists of two artifact types: YAML packages (loaded by HA's package system) and a static SPA (served from HA's www folder).

## Decision

Use **GitHub Releases** to publish a versioned ZIP archive containing both components. Deployment is a manual file copy to the HA config directory.

Release artifact structure:

```
battery-guard-v1.0.0.zip
  packages/battery_guard/
    helpers.yaml
    templates.yaml
    scripts.yaml
    automations.yaml
    dashboard.yaml
  www/battery-guard/
    index.html
    assets/
  README.txt
```

Installation steps:

1. Download the ZIP from GitHub Releases.
2. Extract `packages/battery_guard/` to `/config/packages/`.
3. Extract `www/battery-guard/` to `/config/www/`.
4. Restart Home Assistant (or reload YAML packages).
5. Open the wizard at `http://<ha-ip>:8123/local/battery-guard/index.html`.

CI/CD builds the ZIP automatically on tagged releases via GitHub Actions.

## Alternatives Considered

- **HACS integration:** HACS is designed for custom integrations and Lovelace cards, not YAML packages. Packaging the YAML portion as a HACS integration would require writing a custom component wrapper, which adds complexity without benefit. The wizard SPA could be distributed via HACS as a panel, but splitting distribution across two mechanisms is confusing. Rejected for v1.0; may revisit for the wizard-only portion later.
- **Git clone on HA host:** Requires SSH access to the HA host and Git installed (not available on HA OS). Not feasible for non-technical users. Rejected.
- **HA Add-on:** Overkill for static files and YAML packages. Add-ons run as Docker containers and are intended for long-running services. Rejected.
- **Ansible/automation scripts:** Adds external tooling dependencies. Rejected for the current scale of 3 installations.

## Consequences

- Deployment is manual but straightforward -- copy files and restart.
- Version tracking relies on users checking the GitHub Release version against their installed version.
- Updates require re-downloading and re-copying files. YAML packages may need a HA restart; the wizard SPA updates immediately on file replacement.
- Future improvement: consider a version check endpoint in the wizard that compares installed vs. latest release.
