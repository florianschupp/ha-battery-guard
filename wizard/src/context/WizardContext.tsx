import { useReducer, useState, type ReactNode } from 'react'
import type { WizardConfig, WizardAction, WizardStep } from '../types/wizard-types'
import { WizardContext } from './wizard-context-def'
import { DEFAULT_RESTORE_CONFIG } from '../lib/constants'

const initialConfig: WizardConfig = {
  haUrl: '',
  accessToken: '',
  connected: false,
  entities: [],
  assignments: {},
  deviceActions: {},
  areas: {},
  restoreConfig: DEFAULT_RESTORE_CONFIG,
  deployed: false,
}

function wizardReducer(
  state: WizardConfig,
  action: WizardAction,
): WizardConfig {
  switch (action.type) {
    case 'SET_CONNECTION':
      return { ...state, haUrl: action.haUrl, accessToken: action.accessToken }
    case 'SET_CONNECTED':
      return { ...state, connected: action.connected }
    case 'SET_ENTITIES':
      return { ...state, entities: action.entities }
    case 'SET_ASSIGNMENT':
      return {
        ...state,
        assignments: {
          ...state.assignments,
          [action.entityId]: action.labelIds,
        },
      }
    case 'SET_ASSIGNMENTS':
      return { ...state, assignments: action.assignments }
    case 'SET_DEVICE_ACTION': {
      const entityActions = { ...state.deviceActions[action.entityId] }
      if (action.action) {
        entityActions[action.tier as 'tier1' | 'tier2'] = action.action
      } else {
        delete entityActions[action.tier as 'tier1' | 'tier2']
      }
      // Clean up empty entity entries
      const hasActions = Object.keys(entityActions).length > 0
      const newDeviceActions = { ...state.deviceActions }
      if (hasActions) {
        newDeviceActions[action.entityId] = entityActions
      } else {
        delete newDeviceActions[action.entityId]
      }
      return { ...state, deviceActions: newDeviceActions }
    }
    case 'SET_DEVICE_ACTIONS':
      return { ...state, deviceActions: action.deviceActions }
    case 'SET_AREAS':
      return { ...state, areas: action.areas }
    case 'SET_RESTORE_CONFIG':
      return { ...state, restoreConfig: action.restoreConfig }
    case 'SET_STAY_OFF': {
      const currentStayOff = [...state.restoreConfig.stay_off]
      if (action.stayOff) {
        if (!currentStayOff.includes(action.entityId)) {
          currentStayOff.push(action.entityId)
        }
      } else {
        const idx = currentStayOff.indexOf(action.entityId)
        if (idx !== -1) currentStayOff.splice(idx, 1)
      }
      return {
        ...state,
        restoreConfig: { ...state.restoreConfig, stay_off: currentStayOff },
      }
    }
    case 'SET_DEVICE_DELAY': {
      const newDeviceDelays = { ...state.restoreConfig.device_delays }
      if (action.delay !== null && action.delay > 0) {
        newDeviceDelays[action.entityId] = action.delay
      } else {
        delete newDeviceDelays[action.entityId]
      }
      return {
        ...state,
        restoreConfig: { ...state.restoreConfig, device_delays: newDeviceDelays },
      }
    }
    case 'SET_DEPLOYED':
      return { ...state, deployed: action.deployed }
    case 'RESET':
      return initialConfig
    default:
      return state
  }
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const [config, dispatch] = useReducer(wizardReducer, initialConfig)
  const [currentStep, setCurrentStep] = useState<WizardStep>('connection')

  return (
    <WizardContext.Provider
      value={{ config, dispatch, currentStep, setCurrentStep }}
    >
      {children}
    </WizardContext.Provider>
  )
}
