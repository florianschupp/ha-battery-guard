import { useCallback, useEffect } from 'react'
import { WizardProvider } from './context/WizardContext'
import { useWizard } from './hooks/useWizard'
import { WizardShell } from './components/layout/WizardShell'
import { ConnectionStep } from './steps/ConnectionStep'
import { TierAssignmentStep } from './steps/TierAssignmentStep'
import { SummaryStep } from './steps/SummaryStep'
import { connectFromPanel, isInsidePanel } from './services/ha-websocket'

function WizardRouter() {
  const { currentStep, dispatch, setCurrentStep } = useWizard()

  const autoConnect = useCallback(() => {
    if (isInsidePanel()) {
      connectFromPanel()
        .then(() => {
          dispatch({ type: 'SET_CONNECTED', connected: true })
          setCurrentStep('discovery')
        })
        .catch((err) => {
          console.error('Panel auto-connect failed:', err)
        })
    }
  }, [dispatch, setCurrentStep])

  // Auto-connect when embedded in HA panel
  useEffect(() => {
    autoConnect()
  }, [autoConnect])

  switch (currentStep) {
    case 'connection':
      return <ConnectionStep />
    case 'discovery':
    case 'assignment':
      return <TierAssignmentStep />
    case 'summary':
      return <SummaryStep />
    default:
      return <ConnectionStep />
  }
}

function App() {
  return (
    <WizardProvider>
      <WizardShell>
        <WizardRouter />
      </WizardShell>
    </WizardProvider>
  )
}

export default App
