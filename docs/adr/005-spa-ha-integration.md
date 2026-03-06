# ADR-005: Serve SPA from HA's www Folder with iframe Panel Option

## Status

Accepted

## Context

The setup wizard SPA needs to be accessible to users who are logged into Home Assistant. It must communicate with HA's WebSocket API, which means it either needs to be served from the same origin as HA (to avoid CORS issues) or use token-based authentication from an external origin. The solution must work across all HA installation types (HA OS, Container, Core, Supervised).

## Decision

Serve the built SPA from Home Assistant's `/config/www/` directory, which HA exposes at the `/local/` URL path.

**Primary access:**
```
http://<ha-ip>:8123/local/battery-guard/index.html
```

**Optional sidebar integration** via `panel_custom` in `configuration.yaml`:
```yaml
panel_custom:
  - name: battery-guard
    url_path: battery-guard
    sidebar_title: Battery Guard
    sidebar_icon: mdi:battery-charging
    module_url: /local/battery-guard/panel.js
    embed_iframe: true
```

**Authentication:** The wizard uses `createLongLivedTokenAuth` from `home-assistant-js-websocket`. The user provides a Long-Lived Access Token during the connection step. The token is stored in `sessionStorage` (cleared on tab close) and never persisted to `localStorage` or cookies.

## Alternatives Considered

- **HA Add-on with Ingress:** Add-ons run as Docker containers with their own web server. Ingress provides authenticated proxy access. This is overkill for a static SPA and requires maintaining a Docker image. Rejected.
- **External hosting (e.g., Netlify, Vercel):** Would require CORS configuration on HA and expose the wizard to the public internet. Token handling becomes more sensitive when the SPA is served from an external origin. Rejected.
- **Native HA panel (Lit/Web Components):** HA's frontend uses Lit for native panels. This would provide the tightest integration (automatic auth, sidebar, HA styling) but requires deep knowledge of HA's frontend architecture, a Lit-based build pipeline, and maintaining compatibility with HA frontend updates. Too complex for the project's scope. Rejected.
- **HA custom component with built-in panel:** Requires writing a Python integration to register the panel. Adds unnecessary server-side code for what is purely a client-side application. Rejected.

## Consequences

- The SPA runs on the same origin as HA, avoiding all CORS issues.
- The `/config/www/` directory is supported on all HA installation types.
- Authentication uses a Long-Lived Access Token rather than HA's built-in session auth. Users must generate a token in their HA profile. This is a one-time setup step documented in the wizard's connection screen.
- The `panel_custom` sidebar integration is optional and requires a restart after configuration.
- Static files in `/config/www/` are publicly accessible on the local network without HA authentication. The wizard itself requires a valid token to function, but the HTML/JS/CSS files are served without auth. This is acceptable for a local network deployment.
