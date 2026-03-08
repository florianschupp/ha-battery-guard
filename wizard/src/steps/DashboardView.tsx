import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import {
  discoverEntities,
  discoverAreas,
  getCurrentAssignments,
  loadDeviceActions,
  loadRestoreConfig,
} from '../services/entity-service'
import type { ActionConfig, WizardEntity } from '../types/wizard-types'

/** Format an action config into a human-readable string */
function formatAction(action: ActionConfig | undefined): string {
  if (!action) return '—'
  switch (action.action) {
    case 'turn_off':
      return 'Turn off'
    case 'turn_on':
      return 'Turn on'
    case 'set_hvac_mode':
      return `HVAC: ${String(action.hvac_mode ?? 'off')}`
    case 'set_temperature':
      return `Temp: ${String(action.temperature ?? '?')}°C`
    case 'dim':
      return `Dim: ${String(action.brightness_pct ?? '?')}%`
    default:
      return action.action
  }
}

/** Tier section config */
const TIER_SECTIONS = [
  {
    tierId: 'battery_guard_tier1',
    key: 'tier1',
    title: 'Tier 1 — Immediate Response',
    subtitle: 'These devices are switched immediately when a power outage is detected.',
    dotColor: 'bg-red-500',
    borderColor: 'border-l-red-500',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier2',
    key: 'tier2',
    title: 'Tier 2 — Low Battery',
    subtitle: 'These devices are switched when battery drops below the configured threshold.',
    dotColor: 'bg-amber-500',
    borderColor: 'border-l-amber-500',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier3',
    key: 'tier3',
    title: 'Tier 3 — Critical Infrastructure',
    subtitle: 'These devices are never turned off and run until total power loss.',
    dotColor: 'bg-green-500',
    borderColor: 'border-l-green-500',
    showActions: false,
  },
] as const

export function DashboardView() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)

  const loadAllData = useCallback(async () => {
    setLoading(true)
    try {
      const [entities, areas, deviceActions, restoreConfig] = await Promise.all([
        discoverEntities(),
        discoverAreas(),
        loadDeviceActions(),
        loadRestoreConfig(),
      ])

      const assignments = getCurrentAssignments(entities)

      dispatch({ type: 'SET_ENTITIES', entities })
      dispatch({ type: 'SET_AREAS', areas })
      dispatch({ type: 'SET_ASSIGNMENTS', assignments })
      dispatch({ type: 'SET_DEVICE_ACTIONS', deviceActions })
      dispatch({ type: 'SET_RESTORE_CONFIG', restoreConfig })
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    loadAllData()
  }, [loadAllData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-500">Loading configuration...</p>
        </div>
      </div>
    )
  }

  function getEntitiesForTier(tierId: string): WizardEntity[] {
    return config.entities.filter((e) => {
      const tiers = config.assignments[e.entity_id] || []
      return tiers.includes(tierId)
    })
  }

  function getRestoreMode(entityId: string): string {
    if (config.restoreConfig.stay_off.includes(entityId)) {
      return 'Do Not Restore'
    }
    const customDelay = config.restoreConfig.device_delays?.[entityId]
    if (customDelay !== undefined) {
      return `Custom: ${customDelay}s`
    }
    return 'Standard'
  }

  const totalAssigned = config.entities.filter((e) => {
    const tiers = config.assignments[e.entity_id] || []
    return tiers.some(
      (t) =>
        t === 'battery_guard_tier1' ||
        t === 'battery_guard_tier2' ||
        t === 'battery_guard_tier3',
    )
  }).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Configuration Overview
          </h2>
          <p className="text-gray-500">
            {totalAssigned} device{totalAssigned !== 1 ? 's' : ''} managed by Battery Guard
          </p>
        </div>
        <button
          onClick={() => setCurrentStep('assignment')}
          className="py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
        >
          Edit Configuration
        </button>
      </div>

      {/* Tier sections */}
      <div className="space-y-4 mb-6">
        {TIER_SECTIONS.map((section) => {
          const entities = getEntitiesForTier(section.tierId)

          return (
            <div
              key={section.key}
              className={`bg-white shadow-sm border border-gray-100 border-l-4 ${section.borderColor} rounded-xl p-4`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${section.dotColor}`} />
                <h3 className="text-sm font-semibold text-gray-900">
                  {section.title}
                </h3>
                <span className="text-xs text-gray-400">
                  ({entities.length} device{entities.length !== 1 ? 's' : ''})
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3 ml-[18px]">
                {section.subtitle}
              </p>

              {entities.length === 0 ? (
                <p className="text-sm text-gray-400 ml-[18px]">
                  No devices assigned.
                </p>
              ) : (
                <div className="ml-[18px]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                        <th className="text-left py-1.5 font-medium">Device</th>
                        {section.showActions && (
                          <th className="text-left py-1.5 font-medium w-32">Action</th>
                        )}
                        <th className="text-left py-1.5 font-medium w-32">Restore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entities.map((entity) => {
                        const tierKey = section.key as 'tier1' | 'tier2'
                        const action = section.showActions
                          ? config.deviceActions[entity.entity_id]?.[tierKey]
                          : undefined

                        return (
                          <tr
                            key={entity.entity_id}
                            className="border-b border-gray-50 last:border-0"
                          >
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                  {entity.domain}
                                </span>
                                <span className="text-gray-700 truncate">
                                  {entity.friendly_name}
                                </span>
                              </div>
                            </td>
                            {section.showActions && (
                              <td className="py-1.5 text-gray-600">
                                {formatAction(action || { action: 'turn_off' })}
                              </td>
                            )}
                            <td className="py-1.5">
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded ${
                                  config.restoreConfig.stay_off.includes(entity.entity_id)
                                    ? 'bg-red-50 text-red-600'
                                    : config.restoreConfig.device_delays?.[entity.entity_id] !== undefined
                                      ? 'bg-amber-50 text-amber-600'
                                      : 'bg-gray-50 text-gray-500'
                                }`}
                              >
                                {getRestoreMode(entity.entity_id)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Restore timing summary */}
      <div className="bg-white shadow-sm border border-gray-100 border-l-4 border-l-blue-500 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Restore Timing
          </h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[18px]">
          When grid power returns, devices are restored in order{' '}
          {config.restoreConfig.restore_order
            .map((t) => t.toUpperCase().replace('TIER', 'T'))
            .join(' → ')}
          .
        </p>
        <div className="ml-[18px] grid grid-cols-3 gap-3">
          {config.restoreConfig.restore_order.map((tierKey) => {
            const delays = config.restoreConfig.tier_delays[tierKey] || {
              tier_delay: 0,
              device_delay: 0,
            }
            const label = tierKey.toUpperCase().replace('TIER', 'T')
            return (
              <div
                key={tierKey}
                className="bg-gray-50 rounded-lg p-2.5 text-center"
              >
                <div className="text-xs font-semibold text-gray-700 mb-1">
                  {label}
                </div>
                <div className="text-xs text-gray-500">
                  <div>Wait: {delays.tier_delay}s</div>
                  <div>Between: {delays.device_delay}s</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
