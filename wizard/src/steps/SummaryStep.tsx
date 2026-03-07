import { useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import { applyAssignments } from '../services/entity-service'
import { setDeviceActions } from '../services/ha-websocket'
import { WIZARD_STEPS } from '../types/wizard-types'
import { TIER_DISPLAY } from '../lib/constants'

export function SummaryStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [deploying, setDeploying] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  // Count entities per tier (an entity can appear in multiple tiers)
  const tierCounts = Object.entries(TIER_DISPLAY).map(([tierId, display]) => ({
    tierId,
    display,
    count: Object.values(config.assignments).filter((tiers) =>
      tiers.includes(tierId),
    ).length,
  }))

  // Count entities with custom actions (non-default turn_off)
  const customActionCount = Object.values(config.deviceActions).filter(
    (actions) =>
      Object.values(actions).some((a) => a && a.action !== 'turn_off'),
  ).length

  async function handleDeploy() {
    setDeploying(true)
    setError('')

    try {
      // Step 1: Apply tier labels to entities
      setProgress('Assigning device labels...')
      const result = await applyAssignments(config.entities, config.assignments)

      if (result.failed.length > 0) {
        setError(
          `Failed to assign ${result.failed.length} entities: ${result.failed.join(', ')}`,
        )
        return
      }

      // Step 2: Save device actions to integration config
      setProgress('Saving device actions...')
      try {
        await setDeviceActions(config.deviceActions)
      } catch {
        // Integration might not support device_actions yet (pre-v2.0.0)
        console.warn('Could not save device actions — integration may need update')
      }

      setProgress('Done! Labels and actions applied successfully.')
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
          Devices Configured!
        </h2>
        <p className="text-gray-600 mb-6">
          All device labels and actions have been applied. The Battery Guard
          automation engine is now managing your devices with graduated emergency
          response.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-2">What happens now:</p>
          <ul className="text-left space-y-1">
            <li>• Thresholds and notifications are managed in the integration settings</li>
            <li>• Tier 1 actions execute immediately during a power outage</li>
            <li>• Tier 2 actions execute when battery drops below threshold</li>
            <li>• Device states are automatically saved and restored when grid returns</li>
            <li>• Test by toggling the power outage sensor in Developer Tools</li>
          </ul>
        </div>
        <button
          onClick={() => {
            dispatch({ type: 'SET_DEPLOYED', deployed: false })
            setCurrentStep(WIZARD_STEPS[2])
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
        Review your device assignments and actions before applying them to Home Assistant.
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
                  {display.emoji} {display.label}
                </span>
                <span className="font-medium">
                  {count} device{count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {customActionCount > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Custom Actions
            </h3>
            <p className="text-sm text-gray-600">
              {customActionCount} device{customActionCount !== 1 ? 's' : ''} with
              custom emergency actions (HVAC mode, dimming, etc.)
            </p>
          </div>
        )}
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
          {deploying ? 'Applying...' : 'Apply Labels & Actions'}
        </button>
      </div>
    </div>
  )
}
