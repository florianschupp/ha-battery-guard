import { useWizard } from '../context/WizardContext'
import { WIZARD_STEPS } from '../types/wizard-types'

export function ThresholdStep() {
  const { config, dispatch, setCurrentStep } = useWizard()

  const validationError =
    config.tier2RecoveryThreshold <= config.tier2Threshold
      ? 'Recovery threshold must be higher than shutdown threshold (hysteresis).'
      : null

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Battery Thresholds
      </h2>
      <p className="text-gray-600 mb-6">
        Configure when tier 2 devices should be turned off and back on based on
        battery state of charge (SOC).
      </p>

      <div className="space-y-6">
        {/* Tier 2 shutdown threshold */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tier 2 Shutdown Threshold:{' '}
            <span className="text-amber-600 font-bold">
              {config.tier2Threshold}%
            </span>
          </label>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={config.tier2Threshold}
            onChange={(e) =>
              dispatch({
                type: 'SET_THRESHOLDS',
                tier2: Number(e.target.value),
                recovery: config.tier2RecoveryThreshold,
              })
            }
            className="w-full accent-amber-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Tier 2 devices turn off when battery drops below this level.
          </p>
        </div>

        {/* Recovery threshold */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tier 2 Recovery Threshold:{' '}
            <span className="text-green-600 font-bold">
              {config.tier2RecoveryThreshold}%
            </span>
          </label>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={config.tier2RecoveryThreshold}
            onChange={(e) =>
              dispatch({
                type: 'SET_THRESHOLDS',
                tier2: config.tier2Threshold,
                recovery: Number(e.target.value),
              })
            }
            className="w-full accent-green-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Tier 2 devices turn back on when battery recovers above this level.
          </p>
        </div>

        {/* Visual indicator */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-red-500 font-medium">0%</span>
            <span className="text-gray-400">|</span>
            <span className="text-amber-500 font-medium">
              ← Off at {config.tier2Threshold}%
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-green-500 font-medium">
              On at {config.tier2RecoveryThreshold}% →
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-green-700 font-medium">100%</span>
          </div>
        </div>

        {validationError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {validationError}
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-8">
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[3])}
          className="py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[5])}
          disabled={!!validationError}
          className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
