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

      {/* Power Outage Stages */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Power Outage Stages
          </h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 mb-5">
            During a power outage, Battery Guard executes device actions in stages based on battery level.
            If the battery is already below a threshold when the outage starts, all applicable stages trigger immediately.
          </p>

          <BatteryStageSlider
            critical={config.critical_soc}
            tier2={config.tier2_threshold}
            recovery={config.recovery_threshold}
            onChange={({ critical, tier2, recovery }) => {
              setLocalConfig((prev) => ({
                ...prev,
                critical_soc: critical,
                tier2_threshold: tier2,
                recovery_threshold: recovery,
              }))
              setSaved(false)
            }}
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

/** Multi-range battery slider with colored zones and three drag handles */
function BatteryStageSlider({
  critical,
  tier2,
  recovery,
  onChange,
}: {
  critical: number
  tier2: number
  recovery: number
  onChange: (values: { critical: number; tier2: number; recovery: number }) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const activeHandle = useRef<'critical' | 'tier2' | 'recovery' | null>(null)

  const snap = (value: number, step: number) => Math.round(value / step) * step

  const clampAndUpdate = (handle: 'critical' | 'tier2' | 'recovery', rawPct: number) => {
    let value: number
    switch (handle) {
      case 'critical':
        value = snap(Math.max(5, Math.min(rawPct, tier2 - 1)), 1)
        onChange({ critical: value, tier2, recovery })
        break
      case 'tier2':
        value = snap(Math.max(critical + 5, Math.min(rawPct, recovery - 5)), 5)
        onChange({ critical, tier2: value, recovery })
        break
      case 'recovery':
        value = snap(Math.max(tier2 + 5, Math.min(rawPct, 95)), 5)
        onChange({ critical, tier2, recovery: value })
        break
    }
  }

  const pctFromPointer = (clientX: number) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    return Math.round(((clientX - rect.left) / rect.width) * 100)
  }

  const handlePointerDown = (handle: 'critical' | 'tier2' | 'recovery') =>
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      activeHandle.current = handle
    }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle.current) return
    clampAndUpdate(activeHandle.current, pctFromPointer(e.clientX))
  }

  const handlePointerUp = () => {
    activeHandle.current = null
  }

  const handleNumberInput = (handle: 'critical' | 'tier2' | 'recovery', raw: string) => {
    const v = Number(raw)
    if (Number.isNaN(v)) return
    clampAndUpdate(handle, v)
  }

  const zones = [
    { from: 0, to: critical, color: 'bg-red-400' },
    { from: critical, to: tier2, color: 'bg-orange-400' },
    { from: tier2, to: recovery, color: 'bg-yellow-300' },
    { from: recovery, to: 100, color: 'bg-blue-400' },
  ]

  const handles: { key: 'critical' | 'tier2' | 'recovery'; pct: number; color: string }[] = [
    { key: 'critical', pct: critical, color: 'bg-red-500 ring-red-200' },
    { key: 'tier2', pct: tier2, color: 'bg-orange-500 ring-orange-200' },
    { key: 'recovery', pct: recovery, color: 'bg-green-500 ring-green-200' },
  ]

  return (
    <div className="select-none">
      {/* Slider track */}
      <div className="px-3">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1.5">
          <span>0%</span>
          <span>100%</span>
        </div>
        <div
          ref={trackRef}
          className="relative h-6 cursor-pointer"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Colored zone segments */}
          <div className="absolute inset-0 rounded-full overflow-hidden flex">
            {zones.map((z, i) => (
              <div
                key={i}
                className={`${z.color} h-full transition-all duration-75`}
                style={{ width: `${z.to - z.from}%` }}
              />
            ))}
          </div>

          {/* Drag handles */}
          {handles.map(({ key, pct, color }) => (
            <div
              key={key}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full ${color} ring-2 shadow-md cursor-grab active:cursor-grabbing touch-none`}
              style={{ left: `${pct}%` }}
              onPointerDown={handlePointerDown(key)}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-gray-600 whitespace-nowrap">
                {pct}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 space-y-3">
        <ZoneLegendRow
          color="bg-red-400"
          label="Critical"
          range={`0 – ${critical}%`}
          description="Emergency — only Tier 3 (critical) devices remain active"
          inputValue={critical}
          onInput={(v) => handleNumberInput('critical', v)}
          step={1}
          min={5}
          max={tier2 - 1}
        />
        <ZoneLegendRow
          color="bg-orange-400"
          label="Tier 2"
          range={`${critical} – ${tier2}%`}
          description="Mid-priority device actions execute"
          inputValue={tier2}
          onInput={(v) => handleNumberInput('tier2', v)}
          step={5}
          min={critical + 5}
          max={recovery - 5}
        />
        <ZoneLegendRow
          color="bg-yellow-300"
          label="Recovery Buffer"
          range={`${tier2} – ${recovery}%`}
          description="Hysteresis zone — prevents flicker between Tier 1 and Tier 2"
          inputValue={recovery}
          inputLabel="Recovery at"
          onInput={(v) => handleNumberInput('recovery', v)}
          step={5}
          min={tier2 + 5}
          max={95}
        />
        <ZoneLegendRow
          color="bg-blue-400"
          label="Tier 1"
          range={`${recovery} – 100%`}
          description="Low-priority device actions execute on outage detection"
        />
      </div>
    </div>
  )
}

/** Single row in the zone legend */
function ZoneLegendRow({
  color,
  label,
  range,
  description,
  inputValue,
  inputLabel,
  onInput,
  step,
  min,
  max,
}: {
  color: string
  label: string
  range: string
  description: string
  inputValue?: number
  inputLabel?: string
  onInput?: (value: string) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-3 h-3 rounded-sm ${color} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{label}</span>
            <span className="text-xs text-gray-400 ml-2">{range}</span>
          </div>
          {onInput && inputValue !== undefined && (
            <div className="flex items-center gap-1 shrink-0">
              {inputLabel && <span className="text-xs text-gray-400">{inputLabel}</span>}
              <input
                type="number"
                value={inputValue}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onInput(e.target.value)}
                className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
    </div>
  )
}
