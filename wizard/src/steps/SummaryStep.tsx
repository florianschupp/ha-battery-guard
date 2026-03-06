import { useState } from 'react'
import { useWizard } from '../context/WizardContext'
import { applyAssignments } from '../services/entity-service'
import { callService } from '../services/ha-websocket'
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
      // Step 1: Apply label assignments
      setProgress('Assigning device labels...')
      const result = await applyAssignments(config.entities, config.assignments)

      if (result.failed.length > 0) {
        setError(
          `Failed to assign ${result.failed.length} entities: ${result.failed.join(', ')}`,
        )
      }

      // Step 2: Set thresholds
      setProgress('Setting thresholds...')
      await callService('input_number', 'set_value', {
        value: config.tier2Threshold,
      }, { entity_id: 'input_number.battery_guard_tier2_threshold' })

      await callService('input_number', 'set_value', {
        value: config.tier2RecoveryThreshold,
      }, { entity_id: 'input_number.battery_guard_tier2_recovery_threshold' })

      // Step 3: Enable auto-recovery
      setProgress('Enabling auto-recovery...')
      await callService('input_boolean', 'turn_on', undefined, {
        entity_id: 'input_boolean.battery_guard_auto_recovery',
      })

      setProgress('Done!')
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
          Battery Guard Deployed!
        </h2>
        <p className="text-gray-600 mb-6">
          All device labels have been assigned and thresholds configured.
          The automation is now active.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-2">Next steps:</p>
          <ul className="text-left space-y-1">
            <li>
              • Install the{' '}
              <span className="font-mono text-xs">auto-entities</span> HACS card
              for the dashboard
            </li>
            <li>• Add the Battery Guard dashboard view in Lovelace</li>
            <li>• Test by toggling the power outage sensor in Developer Tools</li>
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Review & Deploy
      </h2>
      <p className="text-gray-600 mb-6">
        Review your configuration before applying it to Home Assistant.
      </p>

      {/* Summary */}
      <div className="space-y-4 mb-6">
        {/* Tier counts */}
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

        {/* Thresholds */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
            Thresholds
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Tier 2 shutdown</span>
              <span className="font-medium">{config.tier2Threshold}% SOC</span>
            </div>
            <div className="flex justify-between">
              <span>Tier 2 recovery</span>
              <span className="font-medium">
                {config.tier2RecoveryThreshold}% SOC
              </span>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
            Notifications
          </h3>
          <p className="text-sm">
            {config.notifyServices.length > 0
              ? config.notifyServices.join(', ')
              : 'HA persistent notifications only'}
          </p>
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
          onClick={() => setCurrentStep(WIZARD_STEPS[5])}
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
          {deploying ? 'Deploying...' : 'Deploy to Home Assistant'}
        </button>
      </div>
    </div>
  )
}
