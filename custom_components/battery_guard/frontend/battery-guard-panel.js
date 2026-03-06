/**
 * Battery Guard Panel — Thin web component wrapper for HA sidebar integration.
 *
 * This component:
 * 1. Receives the `hass` object from Home Assistant
 * 2. Creates an iframe pointing to the React SPA
 * 3. Posts the auth token to the iframe via postMessage
 *
 * The React wizard inside the iframe picks up the auth via `connectFromPanel()`.
 */
class BatteryGuardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set hass(hass) {
    if (!this._initialized) {
      this._hass = hass;
      this._initialize();
    }
  }

  _initialize() {
    this._initialized = true;

    const iframe = document.createElement('iframe');
    iframe.src = '/api/panel_custom/battery_guard/index.html';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';

    iframe.addEventListener('load', () => {
      // Send auth info to the wizard iframe
      iframe.contentWindow.postMessage(
        {
          type: 'battery_guard_auth',
          hassUrl: this._hass.auth
            ? this._hass.auth.data.hassUrl
            : window.location.origin,
          accessToken: this._hass.auth
            ? this._hass.auth.accessToken
            : '',
        },
        '*'
      );
    });

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
        }
      </style>
    `;
    this.shadowRoot.appendChild(iframe);
  }
}

customElements.define('battery-guard-panel', BatteryGuardPanel);
