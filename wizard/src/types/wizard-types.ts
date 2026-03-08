import type { HAEntityRegistryEntry } from './ha-types'

export type WizardStep =
  | 'connection'
  | 'discovery'
  | 'assignment'
  | 'restore'
  | 'summary'
  | 'dashboard'

export const WIZARD_STEPS: WizardStep[] = [
  'connection',
  'discovery',
  'assignment',
  'restore',
  'summary',
]

export const STEP_LABELS: Record<WizardStep, string> = {
  connection: 'Connect',
  discovery: 'Devices',
  assignment: 'Assign',
  restore: 'Restore',
  summary: 'Deploy',
  dashboard: 'Overview',
}

/** Entity with its current tier assignment for the wizard */
export interface WizardEntity extends HAEntityRegistryEntry {
  friendly_name: string
  domain: string
  recommended_tier: string | null
}

/**
 * Per-entity action configuration for a specific tier.
 * Examples:
 *   { action: "turn_off" }
 *   { action: "set_hvac_mode", hvac_mode: "fan_only" }
 *   { action: "dim", brightness_pct: 20 }
 *   { action: "set_temperature", temperature: 18 }
 */
export interface ActionConfig {
  action: string
  [key: string]: unknown
}

/**
 * Per-entity device actions across tiers.
 * Example: { tier1: { action: "set_hvac_mode", hvac_mode: "fan_only" }, tier2: { action: "turn_off" } }
 */
export type EntityDeviceActions = {
  tier1?: ActionConfig
  tier2?: ActionConfig
}

/**
 * All device actions: entity_id → per-tier actions.
 * Stored in config entry options via WebSocket API.
 */
export type DeviceActions = Record<string, EntityDeviceActions>

/**
 * Tier assignment map: entity_id -> array of label_ids.
 * An entity can be in multiple tiers (e.g., climate in T1 + T2 for graduated response).
 * T3 and Ignore are mutually exclusive with T1/T2.
 */
export type TierAssignment = Record<string, string[]>

/** Restore configuration for staged device restore after grid return */
export interface RestoreConfig {
  restore_order: string[]
  tier_delays: Record<string, { tier_delay: number; device_delay: number }>
  stay_off: string[]
  device_delays: Record<string, number>
}

/** Wizard configuration state */
export interface WizardConfig {
  /** HA connection */
  haUrl: string
  accessToken: string
  connected: boolean

  /** Discovered entities (switchable domains only) */
  entities: WizardEntity[]

  /** Current tier assignments (entity_id → label_ids[]) */
  assignments: TierAssignment

  /** Per-device action configurations */
  deviceActions: DeviceActions

  /** Area registry (area_id -> area name) */
  areas: Record<string, string>

  /** Restore configuration */
  restoreConfig: RestoreConfig

  /** Deployment status */
  deployed: boolean
}

export type WizardAction =
  | { type: 'SET_CONNECTION'; haUrl: string; accessToken: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_ENTITIES'; entities: WizardEntity[] }
  | { type: 'SET_ASSIGNMENT'; entityId: string; labelIds: string[] }
  | { type: 'SET_ASSIGNMENTS'; assignments: TierAssignment }
  | { type: 'SET_DEVICE_ACTION'; entityId: string; tier: string; action: ActionConfig | undefined }
  | { type: 'SET_DEVICE_ACTIONS'; deviceActions: DeviceActions }
  | { type: 'SET_AREAS'; areas: Record<string, string> }
  | { type: 'SET_RESTORE_CONFIG'; restoreConfig: RestoreConfig }
  | { type: 'SET_STAY_OFF'; entityId: string; stayOff: boolean }
  | { type: 'SET_DEVICE_DELAY'; entityId: string; delay: number | null }
  | { type: 'SET_DEPLOYED'; deployed: boolean }
  | { type: 'RESET' }
