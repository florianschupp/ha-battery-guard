import { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig, getStates } from '../services/ha-websocket'
import type { BatteryOptEntity, BatteryOptimizationConfig } from '../types/wizard-types'

const DEFAULT_BATTERY_OPT: BatteryOptimizationConfig = {
  enabled: false,
  entities: [],
}

/** Well-known battery entities with human-readable labels */
const KNOWN_ENTITIES: { id: string; label: string; unit: string }[] = [
  { id: 'number.batterien_ladeende_ladestand', label: 'Charging cutoff SOC', unit: '%' },
  { id: 'number.batterien_entlade_ende_ladestand', label: 'Discharge cutoff SOC', unit: '%' },
  { id: 'number.batterien_maximale_ladeleistung', label: 'Max charging power', unit: 'W' },
  { id: 'number.batterien_maximale_entladeleistung', label: 'Max discharging power', unit: 'W' },
]

interface HAState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

function findLabel(entityId: string): string {
  const known = KNOWN_ENTITIES.find((e) => e.id === entityId)
  return known?.label ?? entityId
}

function findUnit(entityId: string): string {
  const known = KNOWN_ENTITIES.find((e) => e.id === entityId)
  return known?.unit ?? ''
}

export function BatteryView() {
  const [batteryOpt, setBatteryOpt] = useState<BatteryOptimizationConfig>(DEFAULT_BATTERY_OPT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaded = useRef(false)
  const fullConfig = useRef<Record<string, unknown>>({})

  // Available number.* entities from HA
  const [numberEntities, setNumberEntities] = useState<HAState[]>([])

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false

    Promise.all([getConfig(), getStates()])
      .then(([configData, statesData]) => {
        if (cancelled) return
        fullConfig.current = configData as Record<string, unknown>
        const opt = (configData as Record<string, unknown>).battery_optimization as
          | BatteryOptimizationConfig
          | undefined
        if (opt) setBatteryOpt(opt)

        // Filter to number.* entities
        const states = statesData as HAState[]
        const nums = states
          .filter((s) => s.entity_id.startsWith('number.'))
          .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
        setNumberEntities(nums)
      })
      .catch(() => {
        /* pre-v2.20 backend or disconnected */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const currentValue = (entityId: string): string | null => {
    const state = numberEntities.find((s) => s.entity_id === entityId)
    if (!state || state.state === 'unavailable' || state.state === 'unknown') return null
    return state.state
  }

  const handleToggle = () => {
    setBatteryOpt((prev) => ({ ...prev, enabled: !prev.enabled }))
  }

  const handleEntityChange = (
    index: number,
    field: keyof BatteryOptEntity,
    value: string | number,
  ) => {
    setBatteryOpt((prev) => {
      const entities = [...prev.entities]
      entities[index] = { ...entities[index], [field]: value }
      return { ...prev, entities }
    })
  }

  const handleEntitySelect = (index: number, entityId: string) => {
    const cv = currentValue(entityId)
    const currentNum = cv ? parseFloat(cv) : 0
    setBatteryOpt((prev) => {
      const entities = [...prev.entities]
      entities[index] = {
        entity_id: entityId,
        normal_value: currentNum,
        outage_value: currentNum,
      }
      return { ...prev, entities }
    })
  }

  const handleAddEntity = () => {
    if (batteryOpt.entities.length >= 5) return
    setBatteryOpt((prev) => ({
      ...prev,
      entities: [...prev.entities, { entity_id: '', normal_value: 0, outage_value: 0 }],
    }))
  }

  const handleRemoveEntity = (index: number) => {
    setBatteryOpt((prev) => ({
      ...prev,
      entities: prev.entities.filter((_, i) => i !== index),
    }))
  }

  const handleSave = async () => {
    setError(null)
    setSaved(false)

    if (batteryOpt.enabled && batteryOpt.entities.length === 0) {
      setError('Add at least one battery entity when optimization is enabled.')
      return
    }
    for (const entity of batteryOpt.entities) {
      if (!entity.entity_id || !entity.entity_id.startsWith('number.')) {
        setError('Please select a valid entity for each row.')
        return
      }
    }

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

  // Entities not yet configured (for the dropdown)
  const usedIds = new Set(batteryOpt.entities.map((e) => e.entity_id))
  const availableEntities = numberEntities.filter((e) => !usedIds.has(e.entity_id))

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Battery Optimization</h2>
        <p className="text-sm text-gray-500 mt-1">
          Automatically adjust battery charging parameters during power outages to maximize solar
          charging and available capacity.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Enable battery optimization</p>
            <p className="text-sm text-gray-500">
              Requires Huawei Solar integration with &quot;Elevate permissions&quot;
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

      {/* Entity configuration (shown when enabled) */}
      {batteryOpt.enabled && (
        <div className="space-y-4">
          {batteryOpt.entities.length === 0 && (
            <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500 mb-2">
                No battery entities configured yet.
              </p>
              <p className="text-xs text-gray-400">
                Add entities to control their values during power outages.
              </p>
            </div>
          )}

          {batteryOpt.entities.map((entity, index) => {
            const cv = currentValue(entity.entity_id)
            const unit = findUnit(entity.entity_id)
            const label = findLabel(entity.entity_id)

            return (
              <div
                key={index}
                className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
              >
                {/* Entity selector + label */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {entity.entity_id ? (
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{label}</p>
                        <p className="text-xs text-gray-400 font-mono">{entity.entity_id}</p>
                      </div>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => handleEntitySelect(index, e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      >
                        <option value="" disabled>
                          Select a battery entity...
                        </option>
                        {/* Known entities first */}
                        {KNOWN_ENTITIES.filter(
                          (k) =>
                            !usedIds.has(k.id) &&
                            numberEntities.some((n) => n.entity_id === k.id),
                        ).length > 0 && (
                          <optgroup label="Recommended">
                            {KNOWN_ENTITIES.filter(
                              (k) =>
                                !usedIds.has(k.id) &&
                                numberEntities.some((n) => n.entity_id === k.id),
                            ).map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.label} ({k.id})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="All number entities">
                          {availableEntities.map((e) => (
                            <option key={e.entity_id} value={e.entity_id}>
                              {(e.attributes.friendly_name as string) || e.entity_id}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveEntity(index)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>

                {/* Values — only when entity selected */}
                {entity.entity_id && (
                  <>
                    {/* Current value indicator */}
                    {cv !== null && (
                      <div className="text-xs text-gray-400">
                        Currently at: <span className="font-medium text-gray-600">{cv}{unit}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Normal (daily operation)
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={entity.normal_value}
                            onChange={(e) =>
                              handleEntityChange(
                                index,
                                'normal_value',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {unit && (
                            <span className="text-xs text-gray-400 w-6">{unit}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Outage (power failure)
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={entity.outage_value}
                            onChange={(e) =>
                              handleEntityChange(
                                index,
                                'outage_value',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {unit && (
                            <span className="text-xs text-gray-400 w-6">{unit}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {batteryOpt.entities.length < 5 && (
            <button
              onClick={handleAddEntity}
              className="w-full py-2.5 text-sm text-blue-600 hover:text-blue-700 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 transition-colors"
            >
              + Add entity
            </button>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">How it works</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li>On outage: applies outage values after Tier 1 shutdown</li>
              <li>On grid return: restores normal values</li>
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
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
