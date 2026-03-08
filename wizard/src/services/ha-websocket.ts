import {
  createConnection,
  createLongLivedTokenAuth,
  type Connection,
} from 'home-assistant-js-websocket'
import type {
  HAArea,
  HAEntityRegistryEntry,
  HALabel,
} from '../types/ha-types'
import type { RestoreConfig } from '../types/wizard-types'

let connection: Connection | null = null

/** Connect to Home Assistant using a Long-Lived Access Token */
export async function connect(
  haUrl: string,
  accessToken: string,
): Promise<Connection> {
  const url = haUrl.replace(/\/+$/, '')
  const auth = createLongLivedTokenAuth(url, accessToken)
  connection = await createConnection({ auth })
  return connection
}

/**
 * Connect from inside an HA panel iframe via same-origin DOM access.
 *
 * Since the iframe is served from HA's own static files (same origin),
 * we can directly access the parent window's <home-assistant> element
 * to read the auth token. No postMessage handshake needed.
 *
 * Retries up to 5 times with 500ms delay to handle race conditions where
 * the iframe loads before HA's frontend has fully initialized.
 */
export async function connectFromPanel(): Promise<Connection> {
  const MAX_RETRIES = 5
  const RETRY_DELAY_MS = 500

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const haElement = window.parent.document.querySelector('home-assistant') as any
    if (haElement?.hass?.auth?.accessToken) {
      const hass = haElement.hass
      const hassUrl = hass.auth.data?.hassUrl || window.location.origin
      return connect(hassUrl, hass.auth.accessToken)
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  throw new Error('Could not access Home Assistant after retries')
}

/** Check if running inside an HA panel iframe */
export function isInsidePanel(): boolean {
  return window.parent !== window
}

/** Disconnect from Home Assistant */
export function disconnect(): void {
  if (connection) {
    connection.close()
    connection = null
  }
}

/** Get the current connection (throws if not connected) */
export function getConnection(): Connection {
  if (!connection) {
    throw new Error('Not connected to Home Assistant')
  }
  return connection
}

/** Send a WebSocket message and return the result */
async function sendMessage<T>(type: string, data?: Record<string, unknown>): Promise<T> {
  const conn = getConnection()
  return conn.sendMessagePromise({ type, ...data })
}

// ============================================================================
// Label Registry
// ============================================================================

/** List all labels */
export async function listLabels(): Promise<HALabel[]> {
  return sendMessage<HALabel[]>('config/label_registry/list')
}

/** Create a new label */
export async function createLabel(label: {
  name: string
  color?: string
  icon?: string
  description?: string
}): Promise<HALabel> {
  return sendMessage<HALabel>('config/label_registry/create', label)
}

/** Delete a label */
export async function deleteLabel(labelId: string): Promise<void> {
  await sendMessage('config/label_registry/delete', { label_id: labelId })
}

// ============================================================================
// Area Registry
// ============================================================================

/** List all areas */
export async function listAreas(): Promise<HAArea[]> {
  return sendMessage<HAArea[]>('config/area_registry/list')
}

// ============================================================================
// Entity Registry
// ============================================================================

/** List all entities from the entity registry */
export async function listEntities(): Promise<HAEntityRegistryEntry[]> {
  return sendMessage<HAEntityRegistryEntry[]>('config/entity_registry/list')
}

/** Update an entity in the registry (e.g., to change labels) */
export async function updateEntity(
  entityId: string,
  data: { labels?: string[]; [key: string]: unknown },
): Promise<HAEntityRegistryEntry> {
  return sendMessage<HAEntityRegistryEntry>('config/entity_registry/update', {
    entity_id: entityId,
    ...data,
  })
}

// ============================================================================
// States
// ============================================================================

/** Get all current entity states */
export async function getStates(): Promise<unknown> {
  return sendMessage('get_states')
}

// ============================================================================
// Services
// ============================================================================

/** Call a Home Assistant service */
export async function callService(
  domain: string,
  service: string,
  serviceData?: Record<string, unknown>,
  target?: { entity_id?: string | string[] },
): Promise<void> {
  await sendMessage('call_service', {
    domain,
    service,
    service_data: serviceData,
    target,
  })
}

/** List all available services */
export async function listServices(): Promise<Record<string, Record<string, unknown>>> {
  return sendMessage('get_services')
}

// ============================================================================
// Battery Guard Custom API
// ============================================================================

/** Get per-device action configurations from the integration */
export async function getDeviceActions(): Promise<Record<string, unknown>> {
  const result = await sendMessage<{ device_actions: Record<string, unknown> }>(
    'battery_guard/get_device_actions',
  )
  return result.device_actions
}

/** Save per-device action configurations to the integration */
export async function setDeviceActions(
  deviceActions: Record<string, unknown>,
): Promise<void> {
  await sendMessage('battery_guard/set_device_actions', {
    device_actions: deviceActions,
  })
}

/** Get restore configuration from the integration */
export async function getRestoreConfig(): Promise<RestoreConfig> {
  const result = await sendMessage<{
    restore_config: RestoreConfig
  }>('battery_guard/get_restore_config')
  return result.restore_config
}

/** Save restore configuration to the integration */
export async function setRestoreConfig(
  restoreConfig: RestoreConfig,
): Promise<void> {
  await sendMessage('battery_guard/set_restore_config', {
    restore_config: restoreConfig,
  })
}
