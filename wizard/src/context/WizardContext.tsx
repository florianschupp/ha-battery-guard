import { useReducer, useState, type ReactNode } from 'react'
import type { WizardConfig, WizardAction, WizardStep } from '../types/wizard-types'
import { WizardContext } from './wizard-context-def'

const initialConfig: WizardConfig = {
  haUrl: '',
  accessToken: '',
  connected: false,
  entities: [],
  assignments: {},
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
          [action.entityId]: action.labelId,
        },
      }
    case 'SET_ASSIGNMENTS':
      return { ...state, assignments: action.assignments }
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
