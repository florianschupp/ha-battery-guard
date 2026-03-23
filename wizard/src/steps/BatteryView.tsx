import { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig } from '../services/ha-websocket'
import type { BatteryOptEntity, BatteryOptimizationConfig } from '../types/wizard-types'

const DEFAULT_BATTERY_OPT: BatteryOptimizationConfig = {
  enabled: false,
  entities: [],
}

const EMPTY_ENTITY: BatteryOptEntity = {
  entity_id: '',
  normal_value: 0,
  outage_value: 0,
}

export function BatteryView() {
  const [batteryOpt, setBatteryOpt] = useState<BatteryOptimizationConfig>(DEFAULT_BATTERY_OPT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaded = useRef(false)
  const fullConfig = useRef<Record<string, unknown>>({})

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false
    getConfig()
      .then((data) => {
        if (cancelled) return
        fullConfig.current = data as Record<string, unknown>
        const opt = (data as Record<string, unknown>).battery_optimization as BatteryOptimizationConfig | undefined
        if (opt) setBatteryOpt(opt)
      })
      .catch(() => { /* pre-v2.20 backend */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggle = () => {
    setBatteryOpt((prev) => ({ ...prev, enabled: !prev.enabled }))
  }

  const handleEntityChange = (index: number, field: keyof BatteryOptEntity, value: string | number) => {
    setBatteryOpt((prev) => {
      const entities = [...prev.entities]
      entities[index] = { ...entities[index], [field]: value }
      return { ...prev, entities }
    })
  }

  const handleAddEntity = () => {
    if (batteryOpt.entities.length >= 5) return
    setBatteryOpt((prev) => ({
      ...prev,
      entities: [...prev.entities, { ...EMPTY_ENTITY }],
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

    // Validate
    if (batteryOpt.enabled && batteryOpt.entities.length === 0) {
      setError('Add at least one battery entity when optimization is enabled.')
      return
    }
    for (const entity of batteryOpt.entities) {
      if (!entity.entity_id.startsWith('number.')) {
        setError(`Entity "${entity.entity_id}" must start with "number."`)
        return
      }
      if (entity.entity_id.trim() === 'number.') {
        setError('Entity ID cannot be empty.')
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

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Battery Optimization</h2>
        <p className="text-sm text-gray-500 mt-1">
          Automatically adjust battery charging parameters during power outages to maximize solar charging and available capacity.
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
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-200">
            {batteryOpt.entities.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-400">
                No battery entities configured. Click &quot;Add entity&quot; to start.
              </div>
            )}
            {batteryOpt.entities.map((entity, index) => (
              <div key={index} className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={entity.entity_id}
                    onChange={(e) => handleEntityChange(index, 'entity_id', e.target.value)}
                    placeholder="number.batterien_ladeende_ladestand"
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <button
                    onClick={() => handleRemoveEntity(index)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove entity"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Normal value</label>
                    <input
                      type="number"
                      value={entity.normal_value}
                      onChange={(e) => handleEntityChange(index, 'normal_value', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Outage value</label>
                    <input
                      type="number"
                      value={entity.outage_value}
                      onChange={(e) => handleEntityChange(index, 'outage_value', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {batteryOpt.entities.length < 5 && (
            <button
              onClick={handleAddEntity}
              className="w-full py-2 text-sm text-blue-600 hover:text-blue-700 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 transition-colors"
            >
              + Add entity
            </button>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">How it works</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li>On outage: applies outage values after Tier 1 shutdown</li>
              <li>On grid return: restores normal values before notification</li>
              <li>Entities that are unavailable are skipped with a warning</li>
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
