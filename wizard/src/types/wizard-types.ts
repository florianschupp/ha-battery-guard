import type { HAEntityRegistryEntry } from './ha-types'

export type WizardStep =
  | 'connection'
  | 'labels'
  | 'discovery'
  | 'assignment'
  | 'thresholds'
  | 'notifications'
  | 'summary'

export const WIZARD_STEPS: WizardStep[] = [
  'connection',
  'labels',
  'discovery',
  'assignment',
  'thresholds',
  'notifications',
  'summary',
]

export const STEP_LABELS: Record<WizardStep, string> = {
  connection: 'Connect',
  labels: 'Labels',
  discovery: 'Devices',
  assignment: 'Assign',
  thresholds: 'Thresholds',
  notifications: 'Notify',
  summary: 'Deploy',
}

/** Entity with its current tier assignment for the wizard */
export interface WizardEntity extends HAEntityRegistryEntry {
  friendly_name: string
  domain: string
  recommended_tier: string | null
}

/** Tier assignment map: entity_id -> label_id */
export type TierAssignment = Record<string, string>

/** Wizard configuration state */
export interface WizardConfig {
  /** HA connection */
  haUrl: string
  accessToken: string
  connected: boolean

  /** Label status */
  labelsReady: boolean

  /** Discovered entities (switchable domains only) */
  entities: WizardEntity[]

  /** Current tier assignments */
  assignments: TierAssignment

  /** SOC thresholds */
  tier2Threshold: number
  tier2RecoveryThreshold: number

  /** Notification targets */
  notifyServices: string[]

  /** Deployment status */
  deployed: boolean
}

export type WizardAction =
  | { type: 'SET_CONNECTION'; haUrl: string; accessToken: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_LABELS_READY'; ready: boolean }
  | { type: 'SET_ENTITIES'; entities: WizardEntity[] }
  | { type: 'SET_ASSIGNMENT'; entityId: string; labelId: string }
  | { type: 'SET_ASSIGNMENTS'; assignments: TierAssignment }
  | { type: 'SET_THRESHOLDS'; tier2: number; recovery: number }
  | { type: 'SET_NOTIFY_SERVICES'; services: string[] }
  | { type: 'SET_DEPLOYED'; deployed: boolean }
  | { type: 'RESET' }
