import { useEffect, useState } from 'react'
import { WizardProvider } from './context/WizardContext'
import { useWizard } from './hooks/useWizard'
import { WizardShell } from './components/layout/WizardShell'
import { ConnectionStep } from './steps/ConnectionStep'
import { TierAssignmentStep } from './steps/TierAssignmentStep'
import { RestoreStep } from './steps/RestoreStep'
import { SummaryStep } from './steps/SummaryStep'
import { DashboardView } from './steps/DashboardView'
import { connectFromPanel, isInsidePanel, listEntities } from './services/ha-websocket'
import { BATTERY_GUARD_LABEL_IDS } from './lib/constants'

/** Quick check if any entities have Battery Guard labels (= already configured) */
async function hasExistingConfig(): Promise<boolean> {
  try {
    const entities = await listEntities()
    return entities.some((e) =>
      e.labels?.some((l: string) => BATTERY_GUARD_LABEL_IDS.includes(l)),
    )
  } catch {
    return false
  }
}

function WizardRouter() {
  const { currentStep, dispatch, setCurrentStep } = useWizard()
  const [panelConnecting, setPanelConnecting] = useState(isInsidePanel)

  // Auto-connect when embedded in HA panel
  useEffect(() => {
    if (!isInsidePanel()) return

    let cancelled = false

    connectFromPanel()
      .then(async () => {
        if (cancelled) return
        dispatch({ type: 'SET_CONNECTED', connected: true })

        // Check if already configured → go to dashboard
        const configured = await hasExistingConfig()
        if (cancelled) return
        setCurrentStep(configured ? 'dashboard' : 'discovery')
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
    case 'dashboard':
      return <DashboardView />
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
