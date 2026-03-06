# CLAUDE.md — Project Instructions for Claude

This file defines the development process and rules for the Battery Guard project.
Claude MUST read and follow these instructions at the start of every session.

## Project Overview

Battery Guard is a HACS Custom Integration for Home Assistant that manages device
shutdowns during power outages in 3 priority tiers. Target: Huawei SUN2000 + LUNA2000
+ BackupBox setups. Deployed at 3 family locations.

## Communication Rules

- Chat language: **German**
- Code, comments, commit messages, docs, labels: **English**
- No `Co-Authored-By` tags in commits

## Development Process (MANDATORY)

Every change MUST follow this process. Claude enforces it actively.

### 1. Backlog (GitHub Issues)

- Every feature or bug MUST have a GitHub Issue before implementation starts
- Use the issue templates: `feature.yml` (with acceptance criteria) or `bug.yml`
- If no issue exists for the requested work, Claude creates one first
- Reference the issue number in commits (e.g., `#3`)

### 2. Conception

- For non-trivial changes: briefly describe the approach before coding
- For architectural decisions: document in `docs/adr/` (ADR format)
- For simple bugfixes: a short description in the chat suffices

### 3. Implementation

- Work directly on `main` branch (no feature branches for this project)
- Follow existing code patterns and conventions
- Run linting before committing: `ruff check` for Python, `npm run lint` for wizard

### 4. Version Bump (Semantic Versioning)

Every release MUST bump the version in BOTH files:
- `custom_components/battery_guard/const.py` → `VERSION = "x.y.z"`
- `custom_components/battery_guard/manifest.json` → `"version": "x.y.z"`

SemVer rules:
- **PATCH** (x.y.Z): Bug fixes, no new features
- **MINOR** (x.Y.0): New features, backwards compatible
- **MAJOR** (X.0.0): Breaking changes

### 5. Build & Commit

If wizard code changed:
1. `cd wizard && npm run build`
2. Copy `dist/` to `custom_components/battery_guard/frontend/`
3. Keep `battery-guard-panel.js` in frontend/

Commit format:
```
type: short description (#issue)

Optional longer explanation.
```
Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`

### 6. Test on Staging (Florian's HA)

- Push to `main` and create GitHub Release
- User updates via HACS and restarts HA
- User verifies on their own installation
- Claude asks: "Bitte teste das Update und gib mir Feedback."

### 7. GitHub Release

- Tag format: `vX.Y.Z`
- Release title: `vX.Y.Z`
- Release notes: changelog with what changed and why
- Include upgrade instructions if needed

### 8. Rollout to Production

- After successful staging test, the user rolls out to family installations
- This step is manual and user-driven

## Process Enforcement Checklist

Before starting implementation, Claude verifies:
- [ ] Is there a GitHub Issue for this work? If not → create one first
- [ ] Is the approach clear? If not → discuss conception first

Before committing, Claude verifies:
- [ ] Version bumped in const.py AND manifest.json?
- [ ] If wizard changed → rebuilt and copied to frontend/?
- [ ] Commit message references the issue number?
- [ ] Linting passes?

Before finishing, Claude verifies:
- [ ] GitHub Release created with changelog?
- [ ] User informed about testing steps?

## Tech Stack

- **Integration**: Python, Home Assistant custom component
- **Wizard**: React 19, TypeScript, Vite, Tailwind CSS
- **CI**: GitHub Actions (HACS validation, Ruff, ESLint, TypeScript, build)
- **Package manager**: npm (wizard)

## Key Directories

```
custom_components/battery_guard/   # HA integration (Python)
wizard/                            # React setup wizard (TypeScript)
docs/                              # Architecture docs, ADRs, PRD
.github/                           # CI workflows, issue templates
```

## Open Backlog

Track at: https://github.com/florianschupp/ha-battery-guard/issues
