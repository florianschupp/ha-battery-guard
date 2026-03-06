/**
 * Battery Guard Panel — Web component wrapper for HA sidebar integration.
 *
 * Auth handshake protocol:
 * 1. Parent creates iframe with the React wizard
 * 2. Wizard sends "battery_guard_ready" when its listener is set up
 * 3. Parent responds with "battery_guard_auth" containing hassUrl + accessToken
 * 4. Wizard connects to HA via WebSocket using the token
 *
 * Also sends auth on iframe load (with delay) as a fallback.
 */
class BatteryGuardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialize();
    }
  }

  _getAuthMessage() {
    return {
      type: 'battery_guard_auth',
      hassUrl: this._hass.auth
        ? this._hass.auth.data.hassUrl
        : window.location.origin,
      accessToken: this._hass.auth
        ? this._hass.auth.accessToken
        : '',
    };
  }

  _initialize() {
    this._initialized = true;

    const iframe = document.createElement('iframe');
    iframe.src = '/api/panel_custom/battery_guard/index.html';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';

    // Listen for the wizard signaling it's ready for auth
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'battery_guard_ready') {
        iframe.contentWindow.postMessage(this._getAuthMessage(), '*');
      }
    });

    // Also send auth after iframe load with a delay as fallback
    iframe.addEventListener('load', () => {
      setTimeout(() => {
        iframe.contentWindow.postMessage(this._getAuthMessage(), '*');
      }, 500);
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
