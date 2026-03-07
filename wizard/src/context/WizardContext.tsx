import { useReducer, useState, type ReactNode } from 'react'
import type { WizardConfig, WizardAction, WizardStep } from '../types/wizard-types'
import { WizardContext } from './wizard-context-def'

const initialConfig: WizardConfig = {
  haUrl: '',
  accessToken: '',
  connected: false,
  entities: [],
  assignments: {},
  deviceActions: {},
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
