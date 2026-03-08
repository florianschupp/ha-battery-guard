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

/** Domain-specific SVG icon */
function DomainIcon({ domain, className }: { domain: string; className?: string }) {
  const cls = className || 'w-4 h-4'
  switch (domain) {
    case 'climate':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13m0 0a4 4 0 110 0zm0 0V3M8 12a4 4 0 004 8 4 4 0 004-8" />
          <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
          <path strokeLinecap="round" d="M12 3v1m0 3v1m0 3v1" />
        </svg>
      )
    case 'light':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5.002 5.002 0 017.072 0l.146.146a.5.5 0 01-.353.854H9.83a.5.5 0 01-.354-.854l.146-.146z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    case 'switch':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
        </svg>
      )
    case 'input_boolean':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <rect x="2" y="8" width="20" height="8" rx="4" />
          <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'media_player':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-3.14a.75.75 0 011.28.53v12.72a.75.75 0 01-1.28.53l-4.72-3.14H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25h2.24z" />
        </svg>
      )
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
        </svg>
      )
  }
}

/** Format an action config into a human-readable string */
function formatAction(action: ActionConfig | undefined): string {
  if (!action) return '—'
  switch (action.action) {
    case 'turn_off':
      return 'Turn off'
    case 'turn_on':
      return 'Turn on'
    case 'set_hvac_mode':
      return String(action.hvac_mode ?? 'off')
    case 'set_temperature':
      return `${String(action.temperature ?? '?')}°C`
    case 'dim':
      return `${String(action.brightness_pct ?? '?')}%`
    default:
      return action.action
  }
}

/** Entity card component */
function EntityCard({
  entity,
  action,
  restoreMode,
  showAction,
  areaName,
}: {
  entity: WizardEntity
  action: string
  restoreMode: string
  showAction: boolean
  areaName: string | null
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2 min-w-0">
        <DomainIcon
          domain={entity.domain}
          className="w-4 h-4 text-gray-400 shrink-0 mt-0.5"
        />
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 truncate">
            {entity.friendly_name}
          </div>
          {areaName && (
            <div className="text-[11px] text-gray-400 truncate">
              {areaName}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-gray-50" />
      <div className="flex items-center justify-between gap-2 text-xs min-w-0">
        {showAction && (
          <span className="text-gray-500 truncate">{action}</span>
        )}
        <span
          className={`px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${
            restoreMode === 'Do Not Restore'
              ? 'bg-gray-100 text-gray-500'
              : restoreMode === 'Standard'
                ? 'bg-gray-50 text-gray-400'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {restoreMode}
        </span>
      </div>
    </div>
  )
}

/** Tier section config */
const TIER_SECTIONS = [
  {
    tierId: 'battery_guard_tier1',
    key: 'tier1',
    title: 'Tier 1',
    label: 'Immediate Response',
    subtitle: 'These devices are switched immediately when a power outage is detected.',
    dotColor: 'bg-rose-400',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier2',
    key: 'tier2',
    title: 'Tier 2',
    label: 'Low Battery',
    subtitle: 'These devices are switched when battery drops below the configured threshold.',
    dotColor: 'bg-amber-400',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier3',
    key: 'tier3',
    title: 'Tier 3',
    label: 'Critical Infrastructure',
    subtitle: 'These devices are never turned off and run until total power loss.',
    dotColor: 'bg-emerald-400',
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
          <div className="inline-block w-8 h-8 border-4 border-gray-300 border-t-gray-600 rounded-full animate-spin mb-4" />
          <p className="text-gray-400">Loading configuration...</p>
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
            {totalAssigned} device{totalAssigned !== 1 ? 's' : ''} managed by
            Battery Guard
          </p>
        </div>
        <button
          onClick={() => setCurrentStep('assignment')}
          className="py-2 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm"
        >
          Edit Configuration
        </button>
      </div>

      {/* Tier sections */}
      <div className="space-y-6 mb-6">
        {TIER_SECTIONS.map((section) => {
          const entities = getEntitiesForTier(section.tierId)

          return (
            <div key={section.key}>
              <div className="flex items-center gap-2.5 mb-1">
                <div
                  className={`w-2 h-2 rounded-full ${section.dotColor}`}
                />
                <h3 className="text-sm font-semibold text-gray-800">
                  {section.title}
                </h3>
                <span className="text-xs font-medium text-gray-400">
                  {section.label}
                </span>
                <span className="text-xs text-gray-400 ml-auto">
                  {entities.length} device
                  {entities.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3 ml-[14px]">
                {section.subtitle}
              </p>

              {entities.length === 0 ? (
                <p className="text-sm text-gray-400 ml-[14px]">
                  No devices assigned.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {entities.map((entity) => {
                    const tierKey = section.key as 'tier1' | 'tier2'
                    const action = section.showActions
                      ? config.deviceActions[entity.entity_id]?.[tierKey]
                      : undefined
                    const areaName = entity.area_id
                      ? config.areas[entity.area_id] || null
                      : null

                    return (
                      <EntityCard
                        key={entity.entity_id}
                        entity={entity}
                        action={formatAction(
                          action || { action: 'turn_off' },
                        )}
                        restoreMode={getRestoreMode(entity.entity_id)}
                        showAction={section.showActions}
                        areaName={areaName}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Restore timing summary */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-gray-800">
            Restore Timing
          </h3>
        </div>
        <p className="text-xs text-gray-400 mb-3 ml-[22px]">
          When grid power returns, devices are restored in order{' '}
          {config.restoreConfig.restore_order
            .map((t) => t.toUpperCase().replace('TIER', 'T'))
            .join(' \u2192 ')}
          .
        </p>
        <div className="grid grid-cols-3 gap-2">
          {config.restoreConfig.restore_order.map((tierKey) => {
            const delays = config.restoreConfig.tier_delays[tierKey] || {
              tier_delay: 0,
              device_delay: 0,
            }
            const label = tierKey.toUpperCase().replace('TIER', 'T')
            return (
              <div
                key={tierKey}
                className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 text-center"
              >
                <div className="text-xs font-semibold text-gray-600 mb-1">
                  {label}
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
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
