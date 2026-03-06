/** Home Assistant entity from the entity registry */
export interface HAEntityRegistryEntry {
  entity_id: string
  name: string | null
  icon: string | null
  platform: string
  disabled_by: string | null
  labels: string[]
  area_id: string | null
  device_id: string | null
  original_name: string | null
}

/** Home Assistant label from the label registry */
export interface HALabel {
  label_id: string
  name: string
  color: string | null
  icon: string | null
  description: string | null
}

/** Home Assistant state object */
export interface HAState {
  entity_id: string
  state: string
  attributes: {
    friendly_name?: string
    icon?: string
    device_class?: string
    unit_of_measurement?: string
    [key: string]: unknown
  }
  last_changed: string
  last_updated: string
}

/** Home Assistant notification service */
export interface HANotifyService {
  domain: string
  service: string
  name: string
}
