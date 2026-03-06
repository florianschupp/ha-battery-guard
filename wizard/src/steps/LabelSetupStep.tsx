import { useEffect, useState } from 'react'
import { useWizard } from '../context/WizardContext'
import {
  checkLabelStatus,
  createMissingLabels,
  hasLegacyLabels,
  type LabelStatus,
} from '../services/label-service'
import { WIZARD_STEPS } from '../types/wizard-types'
import { TIER_DISPLAY } from '../lib/constants'

export function LabelSetupStep() {
  const { dispatch, setCurrentStep } = useWizard()
  const [statuses, setStatuses] = useState<LabelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [hasLegacy, setHasLegacy] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    try {
      const [labelStatuses, legacy] = await Promise.all([
        checkLabelStatus(),
        hasLegacyLabels(),
      ])
      setStatuses(labelStatuses)
      setHasLegacy(legacy)

      if (labelStatuses.every((s) => s.exists)) {
        dispatch({ type: 'SET_LABELS_READY', ready: true })
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateLabels() {
    setCreating(true)
    try {
      await createMissingLabels()
      await loadStatus()
      dispatch({ type: 'SET_LABELS_READY', ready: true })
    } finally {
      setCreating(false)
    }
  }

  const allReady = statuses.every((s) => s.exists)

  function handleNext() {
    setCurrentStep(WIZARD_STEPS[2])
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Checking labels...
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Label Setup</h2>
      <p className="text-gray-600 mb-6">
        Battery Guard uses Home Assistant labels to organize devices into tiers.
      </p>

      {hasLegacy && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          Legacy German labels detected (notstrom_stufe*). New English labels
          will be created alongside them. You can remove the old labels later.
        </div>
      )}

      <div className="space-y-3 mb-6">
        {statuses.map((status) => {
          const display =
            TIER_DISPLAY[status.labelId as keyof typeof TIER_DISPLAY]
          return (
            <div
              key={status.labelId}
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{display?.emoji || '⚪'}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {status.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {display?.description}
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full ${
                  status.exists
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {status.exists ? 'Ready' : 'Missing'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex gap-3">
        {!allReady && (
          <button
            onClick={handleCreateLabels}
            disabled={creating}
            className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors"
          >
            {creating ? 'Creating...' : 'Create Missing Labels'}
          </button>
        )}

        {allReady && (
          <button
            onClick={handleNext}
            className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  )
}
