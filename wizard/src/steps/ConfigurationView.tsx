import { useEffect, useRef, useState } from 'react'
import { getConfig, exportConfig, importConfig, getStates } from '../services/ha-websocket'

interface ConfigData {
  soc_sensor: string
  grid_sensor: string
  use_voltage: boolean
  voltage_phase_a: string
  voltage_phase_b: string
  voltage_phase_c: string
  notify_services: string[]
  battery_charge_entity: string
  battery_discharge_entity: string
}

const DEFAULT_CONFIG_DATA: ConfigData = {
  soc_sensor: '',
  grid_sensor: '',
  use_voltage: false,
  voltage_phase_a: '',
  voltage_phase_b: '',
  voltage_phase_c: '',
  notify_services: [],
  battery_charge_entity: '',
  battery_discharge_entity: '',
}

export function ConfigurationView() {
  const [config, setConfig] = useState<ConfigData>(DEFAULT_CONFIG_DATA)
  const [statesMap, setStatesMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false

    // Refresh live entity availability periodically so the badges don't go stale.
    const refreshStates = async () => {
      try {
        const states = await getStates()
        if (cancelled || !Array.isArray(states)) return
        const list = states as Array<{ entity_id: string; state: string }>
        setStatesMap(new Map(list.map((s) => [s.entity_id, s.state])))
      } catch {
        /* transient states-fetch error — keep the previous snapshot */
      }
    }

    getConfig()
      .then((data) => { if (!cancelled) setConfig(data as unknown as ConfigData) })
      .catch(() => { /* pre-v2.9 backend */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    refreshStates()
    const timer = setInterval(refreshStates, 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  /** A configured sensor is flagged when it is missing or unavailable/unknown. */
  const isUnavailable = (entityId: string): boolean => {
    if (!entityId) return false
    const state = statesMap.get(entityId)
    return state === undefined || state === 'unavailable' || state === 'unknown'
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
          <SensorRow
            label="SOC Sensor"
            value={config.soc_sensor}
            unavailable={isUnavailable(config.soc_sensor)}
          />
          <SensorRow
            label="Grid Sensor"
            value={config.grid_sensor}
            unavailable={isUnavailable(config.grid_sensor)}
          />
          {config.use_voltage && (
            <>
              <div className="border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Voltage Monitoring</span>
              </div>
              <SensorRow label="Phase A" value={config.voltage_phase_a} unavailable={isUnavailable(config.voltage_phase_a)} />
              <SensorRow label="Phase B" value={config.voltage_phase_b} unavailable={isUnavailable(config.voltage_phase_b)} />
              <SensorRow label="Phase C" value={config.voltage_phase_c} unavailable={isUnavailable(config.voltage_phase_c)} />
            </>
          )}
        </div>
      </div>

      {/* Battery Entities — read-only */}
      {(config.battery_charge_entity || config.battery_discharge_entity) && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10.5h.375c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125H21M3.75 18h15A2.25 2.25 0 0021 15.75v-6a2.25 2.25 0 00-2.25-2.25h-15A2.25 2.25 0 001.5 9.75v6A2.25 2.25 0 003.75 18z" />
              </svg>
              Battery Entities
            </h3>
          </div>
          <div className="px-5 py-4 space-y-3">
            <SensorRow label="Charging cutoff SOC" value={config.battery_charge_entity} unavailable={isUnavailable(config.battery_charge_entity)} />
            <SensorRow label="Discharge cutoff SOC" value={config.battery_discharge_entity} unavailable={isUnavailable(config.battery_discharge_entity)} />
          </div>
        </div>
      )}

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

      {/* Backup & Restore */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
            Backup &amp; Restore
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-500">
            Configuration is automatically backed up. If you reinstall Battery Guard, your settings will be offered for restore.
          </p>
          <BackupActions />
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

/** Backup download / upload actions */
function BackupActions() {
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setError(null)
    setStatus(null)
    try {
      const data = await exportConfig()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `battery-guard-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setStatus('Configuration downloaded.')
    } catch {
      setError('Failed to export configuration.')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    setStatus(null)
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const config = JSON.parse(text)
      if (!config.data || typeof config.data !== 'object') {
        setError('Invalid configuration file: missing "data" section.')
        return
      }
      await importConfig(config)
      setStatus('Configuration imported successfully. Reloading...')
      setTimeout(() => window.location.reload(), 2000)
    } catch {
      setError('Failed to import configuration. Check the file format.')
    }

    // Reset file input
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <button
          onClick={handleExport}
          className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
        >
          Download Configuration
        </button>
        <label className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 cursor-pointer">
          Upload Configuration
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
      </div>
      {status && (
        <p className="text-sm text-green-600">{status}</p>
      )}
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}

/** Read-only sensor display row, with an unavailable warning when flagged */
function SensorRow({
  label,
  value,
  unavailable = false,
}: {
  label: string
  value: string
  unavailable?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-600">{label}</span>
      {value ? (
        <div className="flex items-center gap-2">
          {unavailable && (
            <span
              className="flex items-center gap-1 text-xs font-medium text-red-600"
              title="This sensor is currently unavailable — Battery Guard monitoring is degraded."
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              unavailable
            </span>
          )}
          <code
            className={`text-xs px-2 py-1 rounded ${
              unavailable
                ? 'bg-red-50 text-red-700'
                : 'bg-gray-50 text-gray-700'
            }`}
          >
            {value}
          </code>
        </div>
      ) : (
        <span className="text-xs text-gray-400 italic">Not configured</span>
      )}
    </div>
  )
}
