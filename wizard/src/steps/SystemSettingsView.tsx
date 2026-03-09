import { useEffect, useRef, useState } from 'react'
import { getConfig, setConfig } from '../services/ha-websocket'

interface SystemConfig {
  soc_sensor: string
  grid_sensor: string
  use_voltage: boolean
  voltage_phase_a: string
  voltage_phase_b: string
  voltage_phase_c: string
  tier2_threshold: number
  recovery_threshold: number
  critical_soc: number
  notify_services: string[]
}

const DEFAULT_CONFIG: SystemConfig = {
  soc_sensor: '',
  grid_sensor: '',
  use_voltage: false,
  voltage_phase_a: '',
  voltage_phase_b: '',
  voltage_phase_c: '',
  tier2_threshold: 30,
  recovery_threshold: 40,
  critical_soc: 10,
  notify_services: [],
}

export function SystemSettingsView() {
  const [config, setLocalConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false
    getConfig()
      .then((data) => {
        if (!cancelled) setLocalConfig(data as unknown as SystemConfig)
      })
      .catch(() => { /* pre-v2.9 backend */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setError(null)
    setSaved(false)

    // Validate
    if (config.recovery_threshold <= config.tier2_threshold) {
      setError('Recovery threshold must be higher than T2 threshold.')
      return
    }
    if (config.critical_soc >= config.tier2_threshold) {
      setError('Critical SOC must be lower than T2 threshold.')
      return
    }

    setSaving(true)
    try {
      await setConfig({
        tier2_threshold: config.tier2_threshold,
        recovery_threshold: config.recovery_threshold,
        critical_soc: config.critical_soc,
        notify_services: config.notify_services,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  const updateThreshold = (key: keyof SystemConfig, value: number) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
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
        <h2 className="text-lg font-semibold text-gray-900">System Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure battery thresholds, sensors, and notifications.
        </p>
      </div>

      {/* Sensors — read-only */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            Sensors
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <SensorRow label="SOC Sensor" value={config.soc_sensor} />
          <SensorRow label="Grid Sensor" value={config.grid_sensor} />
          {config.use_voltage && (
            <>
              <div className="border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Voltage Monitoring</span>
              </div>
              <SensorRow label="Phase A" value={config.voltage_phase_a} />
              <SensorRow label="Phase B" value={config.voltage_phase_b} />
              <SensorRow label="Phase C" value={config.voltage_phase_c} />
            </>
          )}
          <p className="text-xs text-gray-400 pt-1">
            Sensors are configured via Home Assistant &rarr; Settings &rarr; Integrations &rarr; Battery Guard &rarr; Configure.
          </p>
        </div>
      </div>

      {/* Thresholds — editable */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Battery Thresholds
          </h3>
        </div>
        <div className="px-5 py-4 space-y-5">
          <ThresholdInput
            label="Tier 2 Threshold"
            description="Turn off T2 devices when battery drops below this level"
            value={config.tier2_threshold}
            min={10}
            max={90}
            step={5}
            onChange={(v) => updateThreshold('tier2_threshold', v)}
          />
          <ThresholdInput
            label="Recovery Threshold"
            description="Re-enable T2 devices when battery recovers above this level"
            value={config.recovery_threshold}
            min={10}
            max={90}
            step={5}
            onChange={(v) => updateThreshold('recovery_threshold', v)}
          />
          <ThresholdInput
            label="Critical SOC"
            description="Emergency shutdown of remaining devices at this battery level"
            value={config.critical_soc}
            min={5}
            max={30}
            step={1}
            onChange={(v) => updateThreshold('critical_soc', v)}
          />
        </div>
      </div>

      {/* Notifications — read-only list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            Notifications
          </h3>
        </div>
        <div className="px-5 py-4">
          {config.notify_services.length === 0 ? (
            <p className="text-sm text-gray-400">No notification services configured.</p>
          ) : (
            <div className="space-y-1.5">
              {config.notify_services.map((svc) => (
                <div key={svc} className="flex items-center gap-2 text-sm text-gray-700">
                  <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <code className="text-xs bg-gray-50 px-2 py-0.5 rounded">{svc}</code>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            Notification services are configured via Home Assistant &rarr; Settings &rarr; Integrations &rarr; Battery Guard &rarr; Configure.
          </p>
        </div>
      </div>

      {/* Error / Success messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Settings saved successfully. Integration reloaded.
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

/** Read-only sensor display row */
function SensorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      {value ? (
        <code className="text-xs bg-gray-50 text-gray-700 px-2 py-1 rounded">{value}</code>
      ) : (
        <span className="text-xs text-gray-400 italic">Not configured</span>
      )}
    </div>
  )
}

/** Editable threshold input with label, description, and range */
function ThresholdInput({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  description: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-16 text-right text-sm border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
      </div>
      <p className="text-xs text-gray-400">{description}</p>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-2 accent-blue-500"
      />
    </div>
  )
}
