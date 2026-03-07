import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import { WIZARD_STEPS } from '../types/wizard-types'
import { TIER_DISPLAY } from '../lib/constants'
import { loadRestoreConfig } from '../services/entity-service'

/** Tier keys in restore order with display config */
const RESTORE_TIERS = [
  { key: 'tier3', label: 'Tier 3', tierId: 'battery_guard_tier3' },
  { key: 'tier2', label: 'Tier 2', tierId: 'battery_guard_tier2' },
  { key: 'tier1', label: 'Tier 1', tierId: 'battery_guard_tier1' },
] as const

export function RestoreStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const restoreConfig = await loadRestoreConfig()
      dispatch({ type: 'SET_RESTORE_CONFIG', restoreConfig })
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  function updateTierDelay(
    tierKey: string,
    field: 'tier_delay' | 'device_delay',
    value: number,
  ) {
    const newDelays = { ...config.restoreConfig.tier_delays }
    newDelays[tierKey] = {
      ...newDelays[tierKey],
      [field]: Math.max(0, value),
    }
    dispatch({
      type: 'SET_RESTORE_CONFIG',
      restoreConfig: { ...config.restoreConfig, tier_delays: newDelays },
    })
  }

  // Get all entities assigned to T1, T2, or T3 (not ignore)
  const assignedEntities = config.entities.filter((e) => {
    const tiers = config.assignments[e.entity_id] || []
    return tiers.some(
      (t) =>
        t === 'battery_guard_tier1' ||
        t === 'battery_guard_tier2' ||
        t === 'battery_guard_tier3',
    )
  })

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Loading restore settings...
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Restore Settings
          </h2>
          <p className="text-gray-500">
            Configure how devices restart when grid power returns.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentStep(WIZARD_STEPS[2])}
            className="py-2 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setCurrentStep(WIZARD_STEPS[4])}
            className="py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm text-blue-800">
        <p className="mb-1.5 font-medium">Staged restore prevents inverter overload</p>
        <p className="text-blue-700">
          Devices are restored in order T3 → T2 → T1 with configurable delays
          between tiers and individual devices. High-power devices (HVAC, EV charger)
          should have longer delays.
        </p>
      </div>

      {/* Tier delay cards */}
      <div className="space-y-3 mb-6">
        {RESTORE_TIERS.map((tier) => {
          const display = TIER_DISPLAY[tier.tierId as keyof typeof TIER_DISPLAY]
          const delays = config.restoreConfig.tier_delays[tier.key] || {
            tier_delay: 0,
            device_delay: 5,
          }
          const entityCount = Object.values(config.assignments).filter(
            (tiers) => tiers.includes(tier.tierId),
          ).length
          const dotColor =
            tier.key === 'tier1'
              ? 'bg-red-500'
              : tier.key === 'tier2'
                ? 'bg-amber-500'
                : 'bg-green-500'

          return (
            <div
              key={tier.key}
              className="bg-white shadow-sm border border-gray-100 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                <span className="text-sm font-semibold text-gray-900">
                  {display.label.split(' — ')[0]}
                </span>
                <span className="text-xs text-gray-400">
                  ({entityCount} device{entityCount !== 1 ? 's' : ''})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Wait before restore
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={300}
                      step={5}
                      value={delays.tier_delay}
                      onChange={(e) =>
                        updateTierDelay(
                          tier.key,
                          'tier_delay',
                          parseInt(e.target.value, 10) || 0,
                        )
                      }
                      className="w-20 border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    />
                    <span className="text-xs text-gray-400">seconds</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Delay between devices
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={1}
                      value={delays.device_delay}
                      onChange={(e) =>
                        updateTierDelay(
                          tier.key,
                          'device_delay',
                          parseInt(e.target.value, 10) || 0,
                        )
                      }
                      className="w-20 border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    />
                    <span className="text-xs text-gray-400">seconds</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Do Not Restore section */}
      <div className="bg-white shadow-sm border border-gray-100 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          Do Not Restore
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          These devices will keep their outage state when grid power returns.
          You must restore them manually.
        </p>

        {assignedEntities.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">
            No assigned devices. Go back and assign devices to tiers first.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {assignedEntities.map((entity) => {
              const isStayOff = config.restoreConfig.stay_off.includes(
                entity.entity_id,
              )
              return (
                <label
                  key={entity.entity_id}
                  className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isStayOff}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_STAY_OFF',
                        entityId: entity.entity_id,
                        stayOff: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                    {entity.domain}
                  </span>
                  <span className="text-sm text-gray-700 truncate">
                    {entity.friendly_name}
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {config.restoreConfig.stay_off.length > 0 && (
          <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
            {config.restoreConfig.stay_off.length} device
            {config.restoreConfig.stay_off.length !== 1 ? 's' : ''} will not be
            restored.
          </p>
        )}
      </div>
    </div>
  )
}
