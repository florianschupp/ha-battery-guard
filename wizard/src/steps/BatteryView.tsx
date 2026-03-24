import { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig, getStates } from '../services/ha-websocket'
import type { BatteryOptimizationConfig } from '../types/wizard-types'

const DEFAULT_BATTERY_OPT: BatteryOptimizationConfig = {
  enabled: false,
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

export function BatteryView() {
  const [batteryOpt, setBatteryOpt] = useState<BatteryOptimizationConfig>(DEFAULT_BATTERY_OPT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaded = useRef(false)
  const fullConfig = useRef<Record<string, unknown>>({})

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

        // Read bound entities from config
        const chargeEid = (config.battery_charge_entity as string) || ''
        const dischargeEid = (config.battery_discharge_entity as string) || ''
        setChargeEntity(chargeEid)
        setDischargeEntity(dischargeEid)

        // Read existing optimization config
        const opt = config.battery_optimization as BatteryOptimizationConfig | undefined
        if (opt) {
          setBatteryOpt(opt)
        }

        // Read current state values
        const states = statesData as HAState[]
        const vals: Record<string, string> = {}
        for (const s of states) {
          if (s.entity_id === chargeEid || s.entity_id === dischargeEid) {
            vals[s.entity_id] = s.state
          }
        }
        setCurrentValues(vals)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Find entity config in optimization entities array
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
    setBatteryOpt((prev) => ({ ...prev, enabled: !prev.enabled }))
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
          Adjust battery charging parameters during power outages to maximize solar charging and
          available capacity.
        </p>
      </div>

      {/* No entities bound — show info */}
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

      {/* Enable toggle — only when entities are bound */}
      {hasEntities && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Enable battery optimization</p>
                <p className="text-sm text-gray-500">
                  Automatically adjust limits during power outages
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
          </div>

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

              {/* Info box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                <p className="font-medium mb-1">How it works</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                  <li>On outage: applies outage values after Tier 1 shutdown</li>
                  <li>On grid return: restores daily operation values</li>
                  <li>Unavailable entities are skipped with a warning</li>
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
