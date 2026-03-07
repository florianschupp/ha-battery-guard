import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import {
  discoverAreas,
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
  { id: 'battery_guard_tier1', short: 'T1' },
  { id: 'battery_guard_tier2', short: 'T2' },
  { id: 'battery_guard_tier3', short: 'T3' },
  { id: 'battery_guard_ignore', short: '—' },
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

/** Format action as compact badge text. Returns null for turn_off (default). */
function formatActionBadge(action: ActionConfig | undefined): string | null {
  if (!action || action.action === 'turn_off') return null
  switch (action.action) {
    case 'set_hvac_mode':
      return (action.hvac_mode as string) || 'fan_only'
    case 'set_temperature':
      return `${(action.temperature as number) || 18}°C`
    case 'dim':
      return `${(action.brightness_pct as number) || 20}%`
    default:
      return action.action
  }
}

/** Group entities by area */
function groupByArea(
  entities: WizardEntity[],
  areaNames: Record<string, string>,
): { areaId: string; areaName: string; entities: WizardEntity[] }[] {
  const groups = new Map<string, WizardEntity[]>()

  for (const entity of entities) {
    const areaId = entity.area_id || '__unassigned__'
    if (!groups.has(areaId)) groups.set(areaId, [])
    groups.get(areaId)!.push(entity)
  }

  return Array.from(groups.entries())
    .map(([areaId, ents]) => ({
      areaId,
      areaName:
        areaId === '__unassigned__'
          ? 'No area assigned'
          : areaNames[areaId] || areaId,
      entities: ents,
    }))
    .sort((a, b) => {
      if (a.areaId === '__unassigned__') return 1
      if (b.areaId === '__unassigned__') return -1
      return a.areaName.localeCompare(b.areaName)
    })
}

// ============================================================================
// Tier pill button shared between EntityRow and BulkActionBar
// ============================================================================

function TierPillButton({
  pillId,
  short,
  isActive,
  onClick,
}: {
  pillId: string
  short: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={TIER_DISPLAY[pillId as keyof typeof TIER_DISPLAY]?.label}
      className={`w-9 h-8 rounded-md text-xs font-bold transition-all ${
        isActive
          ? pillId === 'battery_guard_tier1'
            ? 'bg-red-500 text-white shadow-sm'
            : pillId === 'battery_guard_tier2'
              ? 'bg-amber-500 text-white shadow-sm'
              : pillId === 'battery_guard_tier3'
                ? 'bg-green-500 text-white shadow-sm'
                : 'bg-gray-500 text-white shadow-sm'
          : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
      }`}
    >
      {short}
    </button>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function TierAssignmentStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string | null>(null)
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(
    new Set(),
  )
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set())

  const loadEntities = useCallback(async () => {
    setLoading(true)
    try {
      const [entities, deviceActions, areas] = await Promise.all([
        discoverEntities(),
        loadDeviceActions(),
        discoverAreas(),
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
      dispatch({ type: 'SET_AREAS', areas })
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
      const withoutExclusive = current.filter(
        (t) => t !== 'battery_guard_tier3' && t !== 'battery_guard_ignore',
      )

      if (withoutExclusive.includes(tierId)) {
        const newTiers = withoutExclusive.filter((t) => t !== tierId)
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: newTiers })
        const actionKey = tierToActionKey(tierId)
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId,
          tier: actionKey,
          action: undefined,
        })
      } else {
        const newTiers = [...withoutExclusive, tierId]
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: newTiers })
        const actionKey = tierToActionKey(tierId)
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId,
          tier: actionKey,
          action: getDefaultAction(),
        })
      }
    } else {
      if (current.length === 1 && current[0] === tierId) {
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: [] })
      } else {
        dispatch({ type: 'SET_ASSIGNMENT', entityId, labelIds: [tierId] })
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId,
          tier: 'tier1',
          action: undefined,
        })
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId,
          tier: 'tier2',
          action: undefined,
        })
      }
    }
  }

  /** Update action config for an entity + tier */
  function setAction(
    entityId: string,
    tier: 'tier1' | 'tier2',
    action: ActionConfig,
  ) {
    dispatch({ type: 'SET_DEVICE_ACTION', entityId, tier, action })
    // Auto-collapse if changed back to turn_off
    if (action.action === 'turn_off') {
      setExpandedEntities((prev) => {
        const next = new Set(prev)
        next.delete(entityId)
        return next
      })
    }
  }

  function toggleExpanded(entityId: string) {
    setExpandedEntities((prev) => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId)
      else next.add(entityId)
      return next
    })
  }

  function toggleAreaCollapse(areaId: string) {
    setCollapsedAreas((prev) => {
      const next = new Set(prev)
      if (next.has(areaId)) next.delete(areaId)
      else next.add(areaId)
      return next
    })
  }

  /** Apply bulk action to all entities of the current domain filter */
  function applyBulkAction(
    tiers: string[],
    actions: { tier1?: ActionConfig; tier2?: ActionConfig },
  ) {
    const domainEntities = config.entities.filter(
      (e) => e.domain === domainFilter,
    )
    for (const entity of domainEntities) {
      dispatch({
        type: 'SET_ASSIGNMENT',
        entityId: entity.entity_id,
        labelIds: tiers,
      })
      // Clear existing actions first
      dispatch({
        type: 'SET_DEVICE_ACTION',
        entityId: entity.entity_id,
        tier: 'tier1',
        action: undefined,
      })
      dispatch({
        type: 'SET_DEVICE_ACTION',
        entityId: entity.entity_id,
        tier: 'tier2',
        action: undefined,
      })
      // Set new actions
      if (actions.tier1 && tiers.includes('battery_guard_tier1')) {
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId: entity.entity_id,
          tier: 'tier1',
          action: actions.tier1,
        })
      }
      if (actions.tier2 && tiers.includes('battery_guard_tier2')) {
        dispatch({
          type: 'SET_DEVICE_ACTION',
          entityId: entity.entity_id,
          tier: 'tier2',
          action: actions.tier2,
        })
      }
    }
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
    (e) =>
      !config.assignments[e.entity_id] ||
      config.assignments[e.entity_id].length === 0,
  ).length

  // Domain counts for filter chips
  const domainCounts = (TRACKED_DOMAINS as readonly string[]).reduce(
    (acc, d) => {
      acc[d] = config.entities.filter((e) => e.domain === d).length
      return acc
    },
    {} as Record<string, number>,
  )

  // Area grouping
  const areaGroups = groupByArea(filteredEntities, config.areas)
  const showAreaHeaders = areaGroups.length > 1

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Discovering devices...
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Assign Devices to Tiers
          </h2>
          <p className="text-gray-500">
            {config.entities.length} devices found.{' '}
            {unassignedCount > 0
              ? `${unassignedCount} unassigned.`
              : 'All assigned!'}
          </p>
        </div>
        <div className="flex gap-2">
          {unassignedCount > 0 && (
            <button
              onClick={() => {
                for (const entity of config.entities) {
                  const current = config.assignments[entity.entity_id]
                  if (!current || current.length === 0) {
                    dispatch({
                      type: 'SET_ASSIGNMENT',
                      entityId: entity.entity_id,
                      labelIds: ['battery_guard_ignore'],
                    })
                  }
                }
              }}
              className="py-2 px-4 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Ignore rest ({unassignedCount})
            </button>
          )}
          <button
            onClick={() => setCurrentStep(WIZARD_STEPS[3])}
            className="py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
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
              ? 'bg-blue-500 text-white'
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

      {/* Bulk action bar (only when domain filter is active) */}
      {domainFilter && (
        <BulkActionBar
          domain={domainFilter}
          entityCount={domainCounts[domainFilter] || 0}
          existingCustomCount={
            config.entities.filter((e) => {
              if (e.domain !== domainFilter) return false
              const actions = config.deviceActions[e.entity_id]
              if (!actions) return false
              return Object.values(actions).some(
                (a) => a && a.action !== 'turn_off',
              )
            }).length
          }
          onApply={applyBulkAction}
        />
      )}

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search devices..."
        className="w-full px-3 py-2 mb-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
      />

      {/* Entity list grouped by area */}
      <div className="space-y-3">
        {areaGroups.map((group) => (
          <div key={group.areaId}>
            {/* Area header (only if multiple areas) */}
            {showAreaHeaders && (
              <button
                onClick={() => toggleAreaCollapse(group.areaId)}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded mb-1"
              >
                <svg
                  className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsedAreas.has(group.areaId) ? '' : 'rotate-90'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                {group.areaName}
                <span className="text-xs text-gray-400 font-normal">
                  ({group.entities.length})
                </span>
              </button>
            )}

            {/* Entity rows */}
            {!collapsedAreas.has(group.areaId) && (
              <div
                className={`space-y-1 ${showAreaHeaders ? 'ml-3' : ''}`}
              >
                {group.entities.map((entity) => (
                  <EntityRow
                    key={entity.entity_id}
                    entity={entity}
                    tiers={config.assignments[entity.entity_id] || []}
                    deviceActions={
                      config.deviceActions[entity.entity_id] || {}
                    }
                    isExpanded={expandedEntities.has(entity.entity_id)}
                    onToggleTier={toggleTier}
                    onSetAction={setAction}
                    onToggleExpand={toggleExpanded}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {filteredEntities.length === 0 && (
          <p className="text-center py-8 text-gray-400">
            No devices match your filter.
          </p>
        )}
      </div>

      {/* Tier summary at bottom */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(TIER_DISPLAY).map(([tierId, display]) => {
          const count = Object.values(config.assignments).filter((tiers) =>
            tiers.includes(tierId),
          ).length
          const dotColor =
            tierId === 'battery_guard_tier1'
              ? 'bg-red-500'
              : tierId === 'battery_guard_tier2'
                ? 'bg-amber-500'
                : tierId === 'battery_guard_tier3'
                  ? 'bg-green-500'
                  : 'bg-gray-400'
          return (
            <div
              key={tierId}
              className="bg-white shadow-sm border border-gray-100 rounded-xl p-3 text-center"
            >
              <div className="flex justify-center">
                <div className={`w-3 h-3 rounded-full ${dotColor}`} />
              </div>
              <div className="text-xs font-medium text-gray-600 mt-1.5">
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

// ============================================================================
// BulkActionBar — Domain-wide tier+action configuration
// ============================================================================

function BulkActionBar({
  domain,
  entityCount,
  existingCustomCount,
  onApply,
}: {
  domain: string
  entityCount: number
  existingCustomCount: number
  onApply: (
    tiers: string[],
    actions: { tier1?: ActionConfig; tier2?: ActionConfig },
  ) => void
}) {
  const [selectedTiers, setSelectedTiers] = useState<string[]>([])
  const [tier1Action, setTier1Action] = useState<ActionConfig>({
    action: 'turn_off',
  })
  const [tier2Action, setTier2Action] = useState<ActionConfig>({
    action: 'turn_off',
  })

  function toggleBulkTier(tierId: string) {
    setSelectedTiers((prev) => {
      if (isActionTier(tierId)) {
        const withoutExclusive = prev.filter(
          (t) => t !== 'battery_guard_tier3' && t !== 'battery_guard_ignore',
        )
        if (withoutExclusive.includes(tierId)) {
          return withoutExclusive.filter((t) => t !== tierId)
        }
        return [...withoutExclusive, tierId]
      }
      // Exclusive tiers
      if (prev.length === 1 && prev[0] === tierId) return []
      return [tierId]
    })
  }

  const showConfig = hasConfigurableActions(domain)
  const hasT1 = selectedTiers.includes('battery_guard_tier1')
  const hasT2 = selectedTiers.includes('battery_guard_tier2')

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4">
      <p className="text-sm font-medium text-blue-900 mb-2">
        Apply to all {entityCount} {domain} devices:
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        {/* Tier pills */}
        <div className="flex gap-1">
          {TIER_PILLS.map((pill) => (
            <TierPillButton
              key={pill.id}
              pillId={pill.id}
              short={pill.short}
              isActive={selectedTiers.includes(pill.id)}
              onClick={() => toggleBulkTier(pill.id)}
            />
          ))}
        </div>

        {/* Action config for T1 */}
        {showConfig && hasT1 && (
          <ActionConfigRow
            domain={domain}
            tierLabel="T1"
            tierColor="text-red-600"
            action={tier1Action}
            onChange={setTier1Action}
          />
        )}

        {/* Action config for T2 */}
        {showConfig && hasT2 && (
          <ActionConfigRow
            domain={domain}
            tierLabel="T2"
            tierColor="text-amber-600"
            action={tier2Action}
            onChange={setTier2Action}
          />
        )}
      </div>

      {selectedTiers.length > 0 && (
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() =>
              onApply(selectedTiers, {
                tier1: hasT1 ? tier1Action : undefined,
                tier2: hasT2 ? tier2Action : undefined,
              })
            }
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Apply to all ({entityCount})
          </button>
          {existingCustomCount > 0 && (
            <span className="text-xs text-blue-700">
              Overwrites {existingCustomCount} custom config
              {existingCustomCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// EntityRow — Single entity with tier pills, compact badges, expandable config
// ============================================================================

function EntityRow({
  entity,
  tiers,
  deviceActions,
  isExpanded,
  onToggleTier,
  onSetAction,
  onToggleExpand,
}: {
  entity: WizardEntity
  tiers: string[]
  deviceActions: Record<string, ActionConfig>
  isExpanded: boolean
  onToggleTier: (entityId: string, tierId: string) => void
  onSetAction: (
    entityId: string,
    tier: 'tier1' | 'tier2',
    action: ActionConfig,
  ) => void
  onToggleExpand: (entityId: string) => void
}) {
  const isConfigurable =
    hasConfigurableActions(entity.domain) && tiers.some((t) => isActionTier(t))

  // Check if any tier has a non-default action
  const hasNonDefaultAction = tiers
    .filter(isActionTier)
    .some((tierId) => {
      const actionKey = tierToActionKey(tierId)
      const action = deviceActions[actionKey]
      return action && action.action !== 'turn_off'
    })

  const showActionConfig = isConfigurable && (isExpanded || hasNonDefaultAction)

  return (
    <div className="bg-white shadow-sm border border-gray-100 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Tier pill buttons (left side) */}
        <div className="flex gap-1 shrink-0">
          {TIER_PILLS.map((pill) => (
            <TierPillButton
              key={pill.id}
              pillId={pill.id}
              short={pill.short}
              isActive={tiers.includes(pill.id)}
              onClick={() => onToggleTier(entity.entity_id, pill.id)}
            />
          ))}
        </div>

        {/* Entity info + compact action badges */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
              {entity.domain}
            </span>
            <p className="text-sm font-medium text-gray-900 truncate">
              {entity.friendly_name}
            </p>

            {/* Compact action badges */}
            {tiers.filter(isActionTier).map((tierId) => {
              const actionKey = tierToActionKey(tierId)
              const action = deviceActions[actionKey]
              const badge = formatActionBadge(action)
              if (!badge) return null
              const tierShort =
                tierId === 'battery_guard_tier1' ? 'T1' : 'T2'
              const badgeColor =
                tierId === 'battery_guard_tier1'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              return (
                <span
                  key={tierId}
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeColor} whitespace-nowrap shrink-0`}
                >
                  {tierShort}:{badge}
                </span>
              )
            })}

            {/* Gear icon to expand/collapse action config */}
            {isConfigurable && (
              <button
                onClick={() => onToggleExpand(entity.entity_id)}
                className="ml-auto text-gray-400 hover:text-gray-600 p-0.5 shrink-0"
                title="Configure action"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expandable action configuration */}
      {showActionConfig && (
        <div className="mt-2 ml-0 border-t border-gray-100 pt-2">
          <div className="flex flex-wrap gap-3">
            {tiers
              .filter((t) => isActionTier(t))
              .map((tierId) => {
                const actionKey = tierToActionKey(tierId)
                const currentAction = deviceActions[actionKey] || {
                  action: 'turn_off',
                }
                const tierLabel =
                  tierId === 'battery_guard_tier1' ? 'T1' : 'T2'
                const tierColor =
                  tierId === 'battery_guard_tier1'
                    ? 'text-red-600'
                    : 'text-amber-600'

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

// ============================================================================
// ActionConfigRow — Inline action configuration dropdowns
// ============================================================================

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
  const actions = DOMAIN_ACTIONS[domain] || [
    { value: 'turn_off', label: 'Turn off' },
  ]

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-bold ${tierColor}`}>{tierLabel}:</span>

      {/* Action select */}
      <select
        value={action.action}
        onChange={(e) => {
          const newAction: ActionConfig = { action: e.target.value }
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
          onChange={(e) => onChange({ ...action, hvac_mode: e.target.value })}
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
