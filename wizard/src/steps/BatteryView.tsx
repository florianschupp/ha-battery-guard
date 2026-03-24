import { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig, getStates } from '../services/ha-websocket'
import type { BatteryOptimizationConfig } from '../types/wizard-types'

const DEFAULT_BATTERY_OPT: BatteryOptimizationConfig = {
  enabled: false,
  disclaimer_accepted: false,
  entities: [],
}

interface HAState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

interface CardConfig {
  key: 'charge' | 'discharge'
  label: string
  description: string
  entityKey: string
  icon: string
}

const CARDS: CardConfig[] = [
  {
    key: 'charge',
    label: 'Charging limit',
    description: 'How full should the battery charge?',
    entityKey: 'battery_charge_entity',
    icon: '🔋',
  },
  {
    key: 'discharge',
    label: 'Discharge limit',
    description: 'How low can the battery drain?',
    entityKey: 'battery_discharge_entity',
    icon: '🪫',
  },
]

/** Check if an entity looks like a valid SOC % entity */
function validateEntity(entityId: string, states: HAState[]): string | null {
  const state = states.find((s) => s.entity_id === entityId)
  if (!state) return `Entity "${entityId}" not found in Home Assistant.`

  const unit = state.attributes.unit_of_measurement as string | undefined
  if (unit && unit !== '%') {
    return `Entity "${entityId}" has unit "${unit}" — expected "%" for a SOC entity. Please check your selection.`
  }

  const min = state.attributes.min as number | undefined
  const max = state.attributes.max as number | undefined
  if (max !== undefined && max > 100) {
    return `Entity "${entityId}" has max=${max} — this looks like a power entity (W), not a SOC entity (%). Please check your selection.`
  }
  if (min !== undefined && min < 0) {
    return `Entity "${entityId}" has min=${min} — unexpected for a SOC entity.`
  }

  return null
}

export function BatteryView() {
  const [batteryOpt, setBatteryOpt] = useState<BatteryOptimizationConfig>(DEFAULT_BATTERY_OPT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [disclaimerChecked, setDisclaimerChecked] = useState(false)
  const loaded = useRef(false)
  const fullConfig = useRef<Record<string, unknown>>({})
  const allStates = useRef<HAState[]>([])

  // Bound entity IDs from Options Flow
  const [chargeEntity, setChargeEntity] = useState('')
  const [dischargeEntity, setDischargeEntity] = useState('')

  // Current HA state values
  const [currentValues, setCurrentValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false

    Promise.all([getConfig(), getStates()])
      .then(([configData, statesData]) => {
        if (cancelled) return
        const config = configData as Record<string, unknown>
        fullConfig.current = config

        const chargeEid = (config.battery_charge_entity as string) || ''
        const dischargeEid = (config.battery_discharge_entity as string) || ''
        setChargeEntity(chargeEid)
        setDischargeEntity(dischargeEid)

        const opt = config.battery_optimization as BatteryOptimizationConfig | undefined
        if (opt) setBatteryOpt(opt)

        const states = statesData as HAState[]
        allStates.current = states
        const vals: Record<string, string> = {}
        for (const s of states) {
          if (s.entity_id === chargeEid || s.entity_id === dischargeEid) {
            vals[s.entity_id] = s.state
          }
        }
        setCurrentValues(vals)

        // Validate entities on load
        const w: string[] = []
        if (chargeEid) {
          const err = validateEntity(chargeEid, states)
          if (err) w.push(err)
        }
        if (dischargeEid) {
          const err = validateEntity(dischargeEid, states)
          if (err) w.push(err)
        }
        setWarnings(w)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const getEntityOpt = (entityId: string) => {
    return batteryOpt.entities.find((e) => e.entity_id === entityId)
  }

  const setEntityOpt = (entityId: string, normalValue: number, outageValue: number) => {
    setBatteryOpt((prev) => {
      const existing = prev.entities.filter((e) => e.entity_id !== entityId)
      return {
        ...prev,
        entities: [
          ...existing,
          { entity_id: entityId, normal_value: normalValue, outage_value: outageValue },
        ],
      }
    })
  }

  const handleToggle = () => {
    if (!batteryOpt.enabled && !batteryOpt.disclaimer_accepted) {
      // First time enabling — show disclaimer
      setShowDisclaimer(true)
      return
    }
    setBatteryOpt((prev) => ({ ...prev, enabled: !prev.enabled }))
  }

  const handleDisclaimerAccept = () => {
    if (!disclaimerChecked) return
    setBatteryOpt((prev) => ({
      ...prev,
      enabled: true,
      disclaimer_accepted: true,
      disclaimer_accepted_at: new Date().toISOString(),
    }))
    setShowDisclaimer(false)
  }

  const handleRevokeDisclaimer = () => {
    setBatteryOpt((prev) => ({
      ...prev,
      enabled: false,
      disclaimer_accepted: false,
      disclaimer_accepted_at: undefined,
    }))
  }

  const handleSave = async () => {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await setConfig({
        ...fullConfig.current,
        battery_optimization: batteryOpt,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hasEntities = chargeEntity || dischargeEntity

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Battery Optimization</h2>
        <p className="text-sm text-gray-500 mt-1">
          During a power outage, Battery Guard automatically adjusts your battery&apos;s charging
          and discharging limits. This ensures that solar energy is fully captured during the day,
          maximizing the time your home can run on battery power.
        </p>
      </div>

      {/* No entities bound */}
      {!hasEntities && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">No battery entities configured</p>
          <p>
            Go to <strong>Home Assistant &rarr; Settings &rarr; Integrations &rarr; Battery Guard
            &rarr; Configure</strong> to bind your battery charging and discharging entities.
          </p>
          <p className="mt-1 text-amber-600">
            Requires Huawei Solar integration with &quot;Elevate permissions&quot;.
          </p>
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          <p className="font-medium mb-1">Entity validation warnings</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-amber-700">{w}</p>
          ))}
        </div>
      )}

      {hasEntities && (
        <>
          {/* Disclaimer dialog */}
          {showDisclaimer && (
            <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-semibold text-gray-900">External Battery Control</p>
                  <p className="text-sm text-gray-700 mt-1">
                    Battery Guard will actively write values to your battery management system
                    (e.g. Huawei inverter via Modbus). Incorrect settings could affect battery
                    health or system behavior.
                  </p>
                </div>
              </div>

              <div className="text-sm text-gray-700 space-y-1.5 ml-9">
                <p>By enabling this feature, you confirm that:</p>
                <ul className="list-disc list-inside space-y-1 text-gray-600">
                  <li>You understand that Battery Guard will modify battery parameters during power outages</li>
                  <li>You have verified that the correct entities are bound in Configure</li>
                  <li>You have checked that the daily and outage values are within safe ranges</li>
                  <li>You accept responsibility for the configured values</li>
                </ul>
              </div>

              <label className="flex items-center gap-2 ml-9 cursor-pointer">
                <input
                  type="checkbox"
                  checked={disclaimerChecked}
                  onChange={(e) => setDisclaimerChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  I understand and accept the risks
                </span>
              </label>

              <div className="flex gap-3 ml-9">
                <button
                  onClick={handleDisclaimerAccept}
                  disabled={!disclaimerChecked}
                  className="px-4 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Enable Battery Optimization
                </button>
                <button
                  onClick={() => setShowDisclaimer(false)}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Enable toggle */}
          {!showDisclaimer && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Enable battery optimization</p>
                  <p className="text-sm text-gray-500">
                    On outage: raise charge limit &amp; lower discharge limit to maximize capacity.
                    On grid return: restore daily values.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={batteryOpt.enabled}
                  onClick={handleToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    batteryOpt.enabled ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      batteryOpt.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Disclaimer status */}
              {batteryOpt.disclaimer_accepted && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    Disclaimer accepted
                    {batteryOpt.disclaimer_accepted_at &&
                      ` on ${batteryOpt.disclaimer_accepted_at.slice(0, 10)}`}
                  </p>
                  <button
                    onClick={handleRevokeDisclaimer}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Entity cards */}
          {batteryOpt.enabled && (
            <div className="space-y-4">
              {CARDS.map((card) => {
                const entityId =
                  card.key === 'charge' ? chargeEntity : dischargeEntity
                if (!entityId) return null

                const opt = getEntityOpt(entityId)
                const cv = currentValues[entityId]
                const normalVal = opt?.normal_value ?? (cv ? parseFloat(cv) : 0)
                const outageVal = opt?.outage_value ?? (cv ? parseFloat(cv) : 0)

                return (
                  <div
                    key={card.key}
                    className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {card.icon} {card.label}
                      </p>
                      <p className="text-sm text-gray-500">{card.description}</p>
                      <p className="text-xs text-gray-400 font-mono mt-1">{entityId}</p>
                    </div>

                    {cv && cv !== 'unavailable' && cv !== 'unknown' && (
                      <div className="text-xs text-gray-400">
                        Currently at:{' '}
                        <span className="font-medium text-gray-600">{cv}%</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Daily operation
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={normalVal}
                            onChange={(e) =>
                              setEntityOpt(
                                entityId,
                                parseFloat(e.target.value) || 0,
                                outageVal,
                              )
                            }
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-xs text-gray-400 w-4">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Power outage
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={outageVal}
                            onChange={(e) =>
                              setEntityOpt(
                                entityId,
                                normalVal,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-xs text-gray-400 w-4">%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* How it works */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                <p className="font-medium mb-1">How it works</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>
                    <strong>Power outage starts:</strong> Battery Guard raises the charge limit
                    and lowers the discharge limit so the battery captures maximum solar energy
                    and provides maximum usable capacity.
                  </li>
                  <li>
                    <strong>Grid power returns:</strong> Battery Guard restores your daily values
                    to protect battery longevity (e.g. charging only to 90% instead of 100%).
                  </li>
                  <li>
                    If an entity is unavailable, it is skipped with a warning in the logs.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {saved && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              Configuration saved successfully.
            </div>
          )}

          {/* Save button */}
          {batteryOpt.enabled && (
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
