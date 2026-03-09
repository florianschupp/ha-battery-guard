import { useEffect, useRef, useState } from 'react'
import { getConfig } from '../services/ha-websocket'

interface ConfigData {
  soc_sensor: string
  grid_sensor: string
  use_voltage: boolean
  voltage_phase_a: string
  voltage_phase_b: string
  voltage_phase_c: string
  notify_services: string[]
}

const DEFAULT_CONFIG_DATA: ConfigData = {
  soc_sensor: '',
  grid_sensor: '',
  use_voltage: false,
  voltage_phase_a: '',
  voltage_phase_b: '',
  voltage_phase_c: '',
  notify_services: [],
}

export function ConfigurationView() {
  const [config, setConfig] = useState<ConfigData>(DEFAULT_CONFIG_DATA)
  const [loading, setLoading] = useState(true)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false
    getConfig()
      .then((data) => { if (!cancelled) setConfig(data as unknown as ConfigData) })
      .catch(() => { /* pre-v2.9 backend */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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
        <h2 className="text-lg font-semibold text-gray-900">Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Sensor bindings and notification services.
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
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
        <p>
          To change sensors or notification services, go to{' '}
          <strong>Home Assistant &rarr; Settings &rarr; Integrations &rarr; Battery Guard &rarr; Configure</strong>.
        </p>
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
