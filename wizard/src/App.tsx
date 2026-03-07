import { useEffect, useState } from 'react'
import { WizardProvider } from './context/WizardContext'
import { useWizard } from './hooks/useWizard'
import { WizardShell } from './components/layout/WizardShell'
import { ConnectionStep } from './steps/ConnectionStep'
import { TierAssignmentStep } from './steps/TierAssignmentStep'
import { RestoreStep } from './steps/RestoreStep'
import { SummaryStep } from './steps/SummaryStep'
import { connectFromPanel, isInsidePanel } from './services/ha-websocket'

function WizardRouter() {
  const { currentStep, dispatch, setCurrentStep } = useWizard()
  const [panelConnecting, setPanelConnecting] = useState(isInsidePanel)

  // Auto-connect when embedded in HA panel
  useEffect(() => {
    if (!isInsidePanel()) return

    let cancelled = false

    connectFromPanel()
      .then(() => {
        if (cancelled) return
        dispatch({ type: 'SET_CONNECTED', connected: true })
        setCurrentStep('discovery')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Panel auto-connect failed:', err)
        // Fallback to manual connection step
        setPanelConnecting(false)
      })

    return () => {
      cancelled = true
    }
  }, [dispatch, setCurrentStep])

  // Show loading spinner while panel auto-connects
  if (panelConnecting && currentStep === 'connection') {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-500">Connecting to Home Assistant...</p>
        </div>
      </div>
    )
  }

  switch (currentStep) {
    case 'connection':
      return <ConnectionStep />
    case 'discovery':
    case 'assignment':
      return <TierAssignmentStep />
    case 'restore':
      return <RestoreStep />
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
