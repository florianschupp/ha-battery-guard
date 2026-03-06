import {
  createConnection,
  createLongLivedTokenAuth,
  type Connection,
} from 'home-assistant-js-websocket'
import type {
  HAEntityRegistryEntry,
  HALabel,
  HANotifyService,
} from '../types/ha-types'

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

/** Get notification services */
export async function getNotifyServices(): Promise<HANotifyService[]> {
  const services = await listServices()
  const notifyServices: HANotifyService[] = []

  if (services.notify) {
    for (const [serviceName, serviceInfo] of Object.entries(services.notify)) {
      notifyServices.push({
        domain: 'notify',
        service: serviceName,
        name: (serviceInfo as { name?: string }).name || serviceName,
      })
    }
  }

  return notifyServices
}
