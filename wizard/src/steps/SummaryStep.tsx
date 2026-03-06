import { useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import { applyAssignments } from '../services/entity-service'
import { WIZARD_STEPS } from '../types/wizard-types'
import { BATTERY_GUARD_LABEL_IDS, TIER_DISPLAY } from '../lib/constants'

export function SummaryStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [deploying, setDeploying] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const tierCounts = BATTERY_GUARD_LABEL_IDS.map((tierId) => ({
    tierId,
    display: TIER_DISPLAY[tierId as keyof typeof TIER_DISPLAY],
    count: Object.values(config.assignments).filter((a) => a === tierId).length,
  }))

  async function handleDeploy() {
    setDeploying(true)
    setError('')

    try {
      setProgress('Assigning device labels...')
      const result = await applyAssignments(config.entities, config.assignments)

      if (result.failed.length > 0) {
        setError(
          `Failed to assign ${result.failed.length} entities: ${result.failed.join(', ')}`,
        )
        return
      }

      setProgress('Done! Labels applied successfully.')
      dispatch({ type: 'SET_DEPLOYED', deployed: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Deployment failed. Check HA logs.',
      )
    } finally {
      setDeploying(false)
    }
  }

  if (config.deployed) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Devices Assigned!
        </h2>
        <p className="text-gray-600 mb-6">
          All device labels have been applied. The Battery Guard automation
          engine is now managing your devices.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-2">What happens now:</p>
          <ul className="text-left space-y-1">
            <li>• Thresholds and notifications are managed in the integration settings</li>
            <li>• Tier 1 devices turn off immediately during a power outage</li>
            <li>• Tier 2 devices turn off when battery drops below threshold</li>
            <li>• Test by toggling the power outage sensor in Developer Tools</li>
          </ul>
        </div>
        <button
          onClick={() => {
            dispatch({ type: 'SET_DEPLOYED', deployed: false })
            setCurrentStep(WIZARD_STEPS[1])
          }}
          className="mt-6 py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Re-assign Devices
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Review & Apply
      </h2>
      <p className="text-gray-600 mb-6">
        Review your device assignments before applying labels in Home Assistant.
      </p>

      {/* Summary */}
      <div className="space-y-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
            Device Assignment
          </h3>
          <div className="space-y-2">
            {tierCounts.map(({ tierId, display, count }) => (
              <div
                key={tierId}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {display?.emoji} {display?.label}
                </span>
                <span className="font-medium">
                  {count} device{count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {progress && !error && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          {progress}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[2])}
          disabled={deploying}
          className="py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="flex-1 py-2.5 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {deploying ? 'Applying...' : 'Apply Labels'}
        </button>
      </div>
    </div>
  )
}
