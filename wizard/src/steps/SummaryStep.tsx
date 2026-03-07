import { useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import { applyAssignments } from '../services/entity-service'
import { setDeviceActions, setRestoreConfig } from '../services/ha-websocket'
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

      // Step 3: Save restore configuration
      setProgress('Saving restore settings...')
      try {
        await setRestoreConfig(config.restoreConfig)
      } catch {
        console.warn('Could not save restore config — integration may need update')
      }

      setProgress('Done! Labels, actions, and restore settings applied successfully.')
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
        <div className="flex justify-center mb-4">
          <svg className="w-16 h-16 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Devices Configured!
        </h2>
        <p className="text-gray-500 mb-6">
          All device labels and actions have been applied. The Battery Guard
          automation engine is now managing your devices with graduated emergency
          response.
        </p>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
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
            setCurrentStep(WIZARD_STEPS[3])
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
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Review & Apply
      </h2>
      <p className="text-gray-500 mb-6">
        Review your device assignments and actions before applying them to Home Assistant.
      </p>

      {/* Summary */}
      <div className="space-y-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
            Device Assignment
          </h3>
          <div className="space-y-2">
            {tierCounts.map(({ tierId, display, count }) => {
              const dotColor =
                tierId === 'battery_guard_tier1'
                  ? 'bg-red-500'
                  : tierId === 'battery_guard_tier2'
                    ? 'bg-amber-500'
                    : tierId === 'battery_guard_tier3'
                      ? 'bg-green-500'
                      : 'bg-gray-400'
              return (
              <div
                key={tierId}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0`} />
                  {display.label}
                </span>
                <span className="font-medium">
                  {count} device{count !== 1 ? 's' : ''}
                </span>
              </div>
              )
            })}
          </div>
        </div>

        {customActionCount > 0 && (
          <div className="bg-white shadow-sm border border-gray-100 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
              Custom Actions
            </h3>
            <p className="text-sm text-gray-600">
              {customActionCount} device{customActionCount !== 1 ? 's' : ''} with
              custom emergency actions (HVAC mode, dimming, etc.)
            </p>
          </div>
        )}

        <div className="bg-white shadow-sm border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
            Restore Settings
          </h3>
          <div className="space-y-1 text-sm text-gray-600">
            <p>
              Restore order: {config.restoreConfig.restore_order.map((t) => t.toUpperCase().replace('TIER', 'T')).join(' → ')}
            </p>
            {config.restoreConfig.stay_off.length > 0 && (
              <p>
                {config.restoreConfig.stay_off.length} device{config.restoreConfig.stay_off.length !== 1 ? 's' : ''} will stay off after restore
              </p>
            )}
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
          onClick={() => setCurrentStep(WIZARD_STEPS[3])}
          disabled={deploying}
          className="py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="flex-1 py-2.5 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {deploying ? 'Applying...' : 'Apply Labels & Actions'}
        </button>
      </div>
    </div>
  )
}
