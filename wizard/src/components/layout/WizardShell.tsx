import { useWizard } from '../../hooks/useWizard'
import { WIZARD_STEPS, STEP_LABELS } from '../../types/wizard-types'

export function WizardShell({ children }: { children: React.ReactNode }) {
  const { currentStep } = useWizard()
  const currentIndex = WIZARD_STEPS.indexOf(currentStep)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Battery Guard
          </h1>
          <span className="text-sm text-gray-500">Setup Wizard</span>
        </div>
      </header>

      {/* Stepper */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-5xl mx-auto">
          <ol className="flex items-center gap-2">
            {WIZARD_STEPS.map((step, index) => {
              const isActive = index === currentIndex
              const isCompleted = index < currentIndex

              return (
                <li key={step} className="flex items-center gap-2">
                  {index > 0 && (
                    <div
                      className={`w-8 h-px ${isCompleted ? 'bg-amber-500' : 'bg-gray-300'}`}
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                        isActive
                          ? 'bg-amber-500 text-white'
                          : isCompleted
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? '✓' : index + 1}
                    </div>
                    <span
                      className={`text-sm ${
                        isActive
                          ? 'font-medium text-gray-900'
                          : 'text-gray-500'
                      }`}
                    >
                      {STEP_LABELS[step]}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
