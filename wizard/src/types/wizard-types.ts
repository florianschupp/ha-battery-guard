import type { HAEntityRegistryEntry } from './ha-types'

export type WizardStep =
  | 'connection'
  | 'discovery'
  | 'assignment'
  | 'summary'

export const WIZARD_STEPS: WizardStep[] = [
  'connection',
  'discovery',
  'assignment',
  'summary',
]

export const STEP_LABELS: Record<WizardStep, string> = {
  connection: 'Connect',
  discovery: 'Devices',
  assignment: 'Assign',
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

  /** Discovered entities (switchable domains only) */
  entities: WizardEntity[]

  /** Current tier assignments */
  assignments: TierAssignment

  /** Deployment status */
  deployed: boolean
}

export type WizardAction =
  | { type: 'SET_CONNECTION'; haUrl: string; accessToken: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_ENTITIES'; entities: WizardEntity[] }
  | { type: 'SET_ASSIGNMENT'; entityId: string; labelId: string }
  | { type: 'SET_ASSIGNMENTS'; assignments: TierAssignment }
  | { type: 'SET_DEPLOYED'; deployed: boolean }
  | { type: 'RESET' }
