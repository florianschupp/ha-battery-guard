import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import {
  discoverEntities,
  getCurrentAssignments,
  loadDeviceActions,
} from '../services/entity-service'
import { WIZARD_STEPS } from '../types/wizard-types'
import type { WizardEntity, ActionConfig } from '../types/wizard-types'
import {
  DOMAIN_ACTIONS,
  HVAC_MODES,
  TIER_DISPLAY,
  TRACKED_DOMAINS,
} from '../lib/constants'

/** Tier pill button definitions */
const TIER_PILLS = [
  { id: 'battery_guard_tier1', short: 'T1', emoji: '🔴' },
  { id: 'battery_guard_tier2', short: 'T2', emoji: '🟡' },
  { id: 'battery_guard_tier3', short: 'T3', emoji: '🟢' },
  { id: 'battery_guard_ignore', short: '—', emoji: '⚪' },
] as const

/** Check if a tier is an "action" tier (T1 or T2) */
function isActionTier(tierId: string): boolean {
  return tierId === 'battery_guard_tier1' || tierId === 'battery_guard_tier2'
}

/** Map label_id to device_actions key */
function tierToActionKey(tierId: string): 'tier1' | 'tier2' {
  return tierId === 'battery_guard_tier1' ? 'tier1' : 'tier2'
}

/** Check if a domain has configurable actions (beyond just turn_off) */
function hasConfigurableActions(domain: string): boolean {
  const actions = DOMAIN_ACTIONS[domain]
  return !!actions && actions.length > 1
}

/** Get the default action for a domain */
function getDefaultAction(): ActionConfig {
  return { action: 'turn_off' }
}

export function TierAssignmentStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string | null>(null)

  const loadEntities = useCallback(async () => {
    setLoading(true)
    try {
      const [entities, deviceActions] = await Promise.all([
        discoverEntities(),
        loadDeviceActions(),
      ])
      const assignments = getCurrentAssignments(entities)

      // Pre-fill with recommendations where no assignment exists
      for (const entity of entities) {
        if (!assignments[entity.entity_id] && entity.recommended_tier) {
          assignments[entity.entity_id] = [entity.recommended_tier]
        }
      }

      dispatch({ type: 'SET_ENTITIES', entities })
      dispatch({ type: 'SET_ASSIGNMENTS', assignments })
      dispatch({ type: 'SET_DEVICE_ACTIONS', deviceActions })
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    loadEntities()
  }, [loadEntities])

  /** Toggle a tier for an entity */
  function toggleTier(entityId: string, tierId: string) {
    const current = config.assignments[entityId] || []

    if (isActionTier(tierId)) {
      // T1/T2: toggle independently, but clear T3/Ignore if active
      const withoutExclusive = current.filter(
        (t) => t !== 'battery_guard_tier3' && t !== 'battery_guard_ignore',
      )

      if (withoutExclusive.includes(tierId)) {
        // Remove this tier
        const newTiers = withoutExclusive.filter((t) => t !== tierId)
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: newTiers })
        // Also clear action config for this tier
        const actionKey = tierToActionKey(tierId)
        dispatch({ type: 'SET_DEVICE_ACTION', entityId, tier: actionKey, action: undefined })
      } else {
        // Add this tier
        const newTiers = [...withoutExclusive, tierId]
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: newTiers })
        // Set default action
        const actionKey = tierToActionKey(tierId)
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId,
          tier: actionKey,
          action: getDefaultAction(),
        })
      }
    } else {
      // T3 or Ignore: exclusive — replaces everything
      if (current.length === 1 && current[0] === tierId) {
        // Unselect → unassigned
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: [] })
      } else {
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: [tierId] })
        // Clear all action configs
        dispatch({ type: 'SET_DEVICE_ACTION', entityId, tier: 'tier1', action: undefined })
        dispatch({ type: 'SET_DEVICE_ACTION', entityId, tier: 'tier2', action: undefined })
      }
    }
  }

  /** Update action config for an entity + tier */
  function setAction(entityId: string, tier: 'tier1' | 'tier2', action: ActionConfig) {
    dispatch({ type: 'SET_DEVICE_ACTION', entityId, tier, action })
  }

  // Filtering
  const filteredEntities = config.entities.filter((e) => {
    const matchesDomain = !domainFilter || e.domain === domainFilter
    const matchesSearch =
      !search ||
      e.entity_id.toLowerCase().includes(search.toLowerCase()) ||
      e.friendly_name.toLowerCase().includes(search.toLowerCase())
    return matchesDomain && matchesSearch
  })

  const unassignedCount = config.entities.filter(
    (e) => !config.assignments[e.entity_id] || config.assignments[e.entity_id].length === 0,
  ).length

  const allAssigned = unassignedCount === 0

  // Domain counts for filter chips
  const domainCounts = (TRACKED_DOMAINS as readonly string[]).reduce(
    (acc, d) => {
      acc[d] = config.entities.filter((e) => e.domain === d).length
      return acc
    },
    {} as Record<string, number>,
  )

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Discovering devices...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Assign Devices to Tiers
          </h2>
          <p className="text-gray-600">
            {config.entities.length} devices found.{' '}
            {unassignedCount > 0
              ? `${unassignedCount} unassigned.`
              : 'All assigned!'}
          </p>
        </div>
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[3])}
          disabled={!allAssigned}
          className="py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Continue
        </button>
      </div>

      {/* Instruction text */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm text-blue-800">
        <p className="mb-1.5 font-medium">
          Assign each device to an emergency power tier:
        </p>
        <ul className="space-y-0.5 text-blue-700">
          <li>
            <span className="font-medium">T1</span> — Action on power outage
            (e.g. HVAC to fan mode, EV charger off)
          </li>
          <li>
            <span className="font-medium">T2</span> — Action when battery drops
            below threshold (e.g. lights dim, appliances off)
          </li>
          <li>
            <span className="font-medium">T3</span> — Never turned off, stays
            on as long as battery lasts
          </li>
          <li>
            <span className="font-medium">—</span> — Ignored, excluded from
            Battery Guard
          </li>
        </ul>
        <p className="mt-1.5 text-blue-600">
          Climate and light devices can be in both T1 and T2 with different
          actions (e.g. fan mode in T1, off in T2).
        </p>
      </div>

      {/* Domain filter chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setDomainFilter(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            !domainFilter
              ? 'bg-amber-500 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({config.entities.length})
        </button>
        {(TRACKED_DOMAINS as readonly string[]).map((d) =>
          domainCounts[d] > 0 ? (
            <button
              key={d}
              onClick={() => setDomainFilter(domainFilter === d ? null : d)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                domainFilter === d
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {d} ({domainCounts[d]})
            </button>
          ) : null,
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search devices..."
        className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
      />

      {/* Entity list */}
      <div className="space-y-1">
        {filteredEntities.map((entity) => (
          <EntityRow
            key={entity.entity_id}
            entity={entity}
            tiers={config.assignments[entity.entity_id] || []}
            deviceActions={config.deviceActions[entity.entity_id] || {}}
            onToggleTier={toggleTier}
            onSetAction={setAction}
          />
        ))}
        {filteredEntities.length === 0 && (
          <p className="text-center py-8 text-gray-400">No devices match your filter.</p>
        )}
      </div>

      {/* Tier summary at bottom */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(TIER_DISPLAY).map(([tierId, display]) => {
          const count = Object.values(config.assignments).filter((tiers) =>
            tiers.includes(tierId),
          ).length
          return (
            <div
              key={tierId}
              className="bg-white border border-gray-200 rounded-lg p-3 text-center"
            >
              <div className="text-lg">{display.emoji}</div>
              <div className="text-xs font-medium text-gray-600 mt-1">
                {display.label.split(' — ')[0]}
              </div>
              <div className="text-xl font-bold text-gray-900">{count}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Single entity row with inline tier pill buttons */
function EntityRow({
  entity,
  tiers,
  deviceActions,
  onToggleTier,
  onSetAction,
}: {
  entity: WizardEntity
  tiers: string[]
  deviceActions: Record<string, ActionConfig>
  onToggleTier: (entityId: string, tierId: string) => void
  onSetAction: (entityId: string, tier: 'tier1' | 'tier2', action: ActionConfig) => void
}) {
  const showActionConfig =
    hasConfigurableActions(entity.domain) &&
    tiers.some((t) => isActionTier(t))

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="flex items-center gap-3">
        {/* Entity info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
              {entity.domain}
            </span>
            <p className="text-sm font-medium text-gray-900 truncate">
              {entity.friendly_name}
            </p>
          </div>
        </div>

        {/* Tier pill buttons */}
        <div className="flex gap-1 shrink-0">
          {TIER_PILLS.map((pill) => {
            const isActive = tiers.includes(pill.id)
            return (
              <button
                key={pill.id}
                onClick={() => onToggleTier(entity.entity_id, pill.id)}
                title={TIER_DISPLAY[pill.id as keyof typeof TIER_DISPLAY]?.label}
                className={`w-9 h-8 rounded-md text-xs font-bold transition-all ${
                  isActive
                    ? pill.id === 'battery_guard_tier1'
                      ? 'bg-red-500 text-white shadow-sm'
                      : pill.id === 'battery_guard_tier2'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : pill.id === 'battery_guard_tier3'
                          ? 'bg-green-500 text-white shadow-sm'
                          : 'bg-gray-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                }`}
              >
                {pill.short}
              </button>
            )
          })}
        </div>
      </div>

      {/* Action configuration (only for climate/light in T1/T2) */}
      {showActionConfig && (
        <div className="mt-2 ml-0 border-t border-gray-100 pt-2">
          <div className="flex flex-wrap gap-3">
            {tiers
              .filter((t) => isActionTier(t))
              .map((tierId) => {
                const actionKey = tierToActionKey(tierId)
                const currentAction = deviceActions[actionKey] || { action: 'turn_off' }
                const tierLabel = tierId === 'battery_guard_tier1' ? 'T1' : 'T2'
                const tierColor =
                  tierId === 'battery_guard_tier1' ? 'text-red-600' : 'text-amber-600'

                return (
                  <ActionConfigRow
                    key={tierId}
                    domain={entity.domain}
                    tierLabel={tierLabel}
                    tierColor={tierColor}
                    action={currentAction}
                    onChange={(action) =>
                      onSetAction(entity.entity_id, actionKey, action)
                    }
                  />
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline action configuration for a specific tier */
function ActionConfigRow({
  domain,
  tierLabel,
  tierColor,
  action,
  onChange,
}: {
  domain: string
  tierLabel: string
  tierColor: string
  action: ActionConfig
  onChange: (action: ActionConfig) => void
}) {
  const actions = DOMAIN_ACTIONS[domain] || [{ value: 'turn_off', label: 'Turn off' }]

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-bold ${tierColor}`}>{tierLabel}:</span>

      {/* Action select */}
      <select
        value={action.action}
        onChange={(e) => {
          const newAction: ActionConfig = { action: e.target.value }
          // Set default params for specific actions
          if (e.target.value === 'set_hvac_mode') {
            newAction.hvac_mode = 'fan_only'
          } else if (e.target.value === 'dim') {
            newAction.brightness_pct = 20
          } else if (e.target.value === 'set_temperature') {
            newAction.temperature = 18
          }
          onChange(newAction)
        }}
        className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white"
      >
        {actions.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>

      {/* HVAC mode param */}
      {action.action === 'set_hvac_mode' && (
        <select
          value={(action.hvac_mode as string) || 'fan_only'}
          onChange={(e) =>
            onChange({ ...action, hvac_mode: e.target.value })
          }
          className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white"
        >
          {HVAC_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      )}

      {/* Temperature param */}
      {action.action === 'set_temperature' && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={10}
            max={35}
            step={0.5}
            value={(action.temperature as number) || 18}
            onChange={(e) =>
              onChange({ ...action, temperature: parseFloat(e.target.value) })
            }
            className="w-14 border border-gray-200 rounded px-1.5 py-1 text-xs bg-white"
          />
          <span className="text-gray-400">°C</span>
        </div>
      )}

      {/* Brightness param */}
      {action.action === 'dim' && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={100}
            value={(action.brightness_pct as number) || 20}
            onChange={(e) =>
              onChange({
                ...action,
                brightness_pct: parseInt(e.target.value, 10),
              })
            }
            className="w-14 border border-gray-200 rounded px-1.5 py-1 text-xs bg-white"
          />
          <span className="text-gray-400">%</span>
        </div>
      )}
    </div>
  )
}
