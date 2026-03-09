import { useEffect, useRef, useState } from 'react'
import { getConfig, getStates, subscribeStateChanges } from '../services/ha-websocket'

export interface StatusData {
  soc: number | null
  isActive: boolean
  isOutage: boolean
  loading: boolean
}

interface HAState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

/** Hook that provides live Battery Guard status (SOC, active, outage). */
export function useStatus(): StatusData {
  const [status, setStatus] = useState<StatusData>({
    soc: null,
    isActive: false,
    isOutage: false,
    loading: true,
  })
  const socSensorRef = useRef<string | null>(null)
  const initDone = useRef(false)

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    const init = async () => {
      try {
        // 1. Get SOC sensor entity_id from config
        const config = await getConfig()
        const socSensor = (config.soc_sensor as string) || ''
        socSensorRef.current = socSensor

        // 2. Get initial states
        const states = (await getStates()) as HAState[]
        if (cancelled) return

        const initial: Partial<StatusData> = { loading: false }

        for (const s of states) {
          if (socSensor && s.entity_id === socSensor) {
            const val = parseFloat(s.state)
            if (!isNaN(val)) initial.soc = val
          }
          if (s.entity_id.includes('battery_guard') && s.entity_id.endsWith('_active')) {
            initial.isActive = s.state === 'on'
          }
          if (s.entity_id.includes('battery_guard') && s.entity_id.endsWith('_power_outage')) {
            initial.isOutage = s.state === 'on'
          }
        }

        setStatus((prev) => ({ ...prev, ...initial }))

        // 3. Subscribe to live updates
        unsubscribe = await subscribeStateChanges((event) => {
          if (!event.new_state) return
          const { entity_id, new_state } = event

          if (socSensorRef.current && entity_id === socSensorRef.current) {
            const val = parseFloat(new_state.state)
            if (!isNaN(val)) {
              setStatus((prev) => ({ ...prev, soc: val }))
            }
          }

          if (entity_id.includes('battery_guard') && entity_id.endsWith('_active')) {
            setStatus((prev) => ({ ...prev, isActive: new_state.state === 'on' }))
          }

          if (entity_id.includes('battery_guard') && entity_id.endsWith('_power_outage')) {
            setStatus((prev) => ({ ...prev, isOutage: new_state.state === 'on' }))
          }
        })
      } catch {
        if (!cancelled) {
          setStatus((prev) => ({ ...prev, loading: false }))
        }
      }
    }

    init()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return status
}
