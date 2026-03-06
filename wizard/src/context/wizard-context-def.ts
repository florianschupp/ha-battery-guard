import { createContext } from 'react'
import type { WizardAction, WizardStep, WizardConfig } from '../types/wizard-types'

export interface WizardContextValue {
  config: WizardConfig
  dispatch: React.Dispatch<WizardAction>
  currentStep: WizardStep
  setCurrentStep: (step: WizardStep) => void
}

export const WizardContext = createContext<WizardContextValue | null>(null)
