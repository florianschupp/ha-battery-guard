import {
  createContext,
  useContext,
  useReducer,
  useState,
  type ReactNode,
} from 'react'
import type {
  WizardConfig,
  WizardAction,
  WizardStep,
} from '../types/wizard-types'
import {
  DEFAULT_TIER2_THRESHOLD,
  DEFAULT_TIER2_RECOVERY_THRESHOLD,
} from '../lib/constants'

const initialConfig: WizardConfig = {
  haUrl: '',
  accessToken: '',
  connected: false,
  labelsReady: false,
  entities: [],
  assignments: {},
  tier2Threshold: DEFAULT_TIER2_THRESHOLD,
  tier2RecoveryThreshold: DEFAULT_TIER2_RECOVERY_THRESHOLD,
  notifyServices: [],
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
    case 'SET_LABELS_READY':
      return { ...state, labelsReady: action.ready }
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
    case 'SET_THRESHOLDS':
      return {
        ...state,
        tier2Threshold: action.tier2,
        tier2RecoveryThreshold: action.recovery,
      }
    case 'SET_NOTIFY_SERVICES':
      return { ...state, notifyServices: action.services }
    case 'SET_DEPLOYED':
      return { ...state, deployed: action.deployed }
    case 'RESET':
      return initialConfig
    default:
      return state
  }
}

interface WizardContextValue {
  config: WizardConfig
  dispatch: React.Dispatch<WizardAction>
  currentStep: WizardStep
  setCurrentStep: (step: WizardStep) => void
}

const WizardContext = createContext<WizardContextValue | null>(null)

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

export function useWizard() {
  const context = useContext(WizardContext)
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider')
  }
  return context
}
