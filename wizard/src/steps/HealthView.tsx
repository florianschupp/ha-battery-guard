import { useCallback, useEffect, useState } from 'react'
import { getSensorHealth } from '../services/ha-websocket'
import type { SensorHealth } from '../types/wizard-types'

/** Auto-refresh interval for the health snapshot */
const REFRESH_MS = 15000

/** Format an ISO timestamp as a localized date/time, or a dash if missing. */
function formatLastSeen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function HealthView() {
  const [sensors, setSensors] = useState<SensorHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getSensorHealth()
      setSensors(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sensor health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const unavailableCount = sensors.filter((s) => !s.available).length

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-gray-900">Sensor Health</h1>
        <button
          onClick={load}
          className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Availability of the sensors Battery Guard relies on. If a sensor is
        unavailable, outage detection is degraded.
      </p>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && sensors.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">
          No required sensors configured yet.
        </p>
      )}

      {!loading && !error && sensors.length > 0 && (
        <>
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${
              unavailableCount === 0
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            {unavailableCount === 0
              ? `All ${sensors.length} sensors available`
              : `${unavailableCount} of ${sensors.length} sensor${
                  sensors.length !== 1 ? 's' : ''
                } unavailable — monitoring degraded`}
          </div>

          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
            {sensors.map((s) => (
              <div key={s.entity_id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                    s.available ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  aria-label={s.available ? 'available' : 'unavailable'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {s.role}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{s.entity_id}</div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-medium ${
                      s.available ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {s.available ? s.state ?? 'available' : 'unavailable'}
                  </div>
                  <div className="text-xs text-gray-400">
                    last seen {formatLastSeen(s.last_available)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
