import { WizardProvider, useWizard } from './context/WizardContext'
import { WizardShell } from './components/layout/WizardShell'
import { ConnectionStep } from './steps/ConnectionStep'
import { LabelSetupStep } from './steps/LabelSetupStep'
import { TierAssignmentStep } from './steps/TierAssignmentStep'
import { ThresholdStep } from './steps/ThresholdStep'
import { NotificationStep } from './steps/NotificationStep'
import { SummaryStep } from './steps/SummaryStep'

function WizardRouter() {
  const { currentStep } = useWizard()

  switch (currentStep) {
    case 'connection':
      return <ConnectionStep />
    case 'labels':
      return <LabelSetupStep />
    case 'discovery':
    case 'assignment':
      return <TierAssignmentStep />
    case 'thresholds':
      return <ThresholdStep />
    case 'notifications':
      return <NotificationStep />
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
