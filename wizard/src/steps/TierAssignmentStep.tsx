import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import {
  discoverEntities,
  getCurrentAssignments,
} from '../services/entity-service'
import { WIZARD_STEPS } from '../types/wizard-types'
import {
  BATTERY_GUARD_LABEL_IDS,
  TIER_DISPLAY,
} from '../lib/constants'
import type { WizardEntity } from '../types/wizard-types'

export function TierAssignmentStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const loadEntities = useCallback(async () => {
    setLoading(true)
    try {
      const entities = await discoverEntities()
      const assignments = getCurrentAssignments(entities)

      // Pre-fill with recommendations where no assignment exists
      for (const entity of entities) {
        if (!assignments[entity.entity_id] && entity.recommended_tier) {
          assignments[entity.entity_id] = entity.recommended_tier
        }
      }

      dispatch({ type: 'SET_ENTITIES', entities })
      dispatch({ type: 'SET_ASSIGNMENTS', assignments })
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    loadEntities()
  }, [loadEntities])

  function assignEntity(entityId: string, tierId: string) {
    dispatch({ type: 'SET_ASSIGNMENT', entityId, labelId: tierId })
  }

  const filteredEntities = config.entities.filter((e) => {
    const matchesSearch =
      !search ||
      e.entity_id.toLowerCase().includes(search.toLowerCase()) ||
      e.friendly_name.toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  })

  function getEntitiesForTier(tierId: string): WizardEntity[] {
    return filteredEntities.filter(
      (e) => config.assignments[e.entity_id] === tierId,
    )
  }

  const unassigned = filteredEntities.filter(
    (e) => !config.assignments[e.entity_id],
  )

  const allAssigned = config.entities.every(
    (e) => config.assignments[e.entity_id],
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
            {unassigned.length > 0
              ? `${unassigned.length} unassigned.`
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
            <span className="font-medium">Tier 1</span> — Turned off
            immediately when a power outage is detected (e.g. HVAC, EV
            charger)
          </li>
          <li>
            <span className="font-medium">Tier 2</span> — Turned off when
            battery drops below the configured threshold (e.g. lights,
            refrigerators)
          </li>
          <li>
            <span className="font-medium">Tier 3</span> — Never turned off,
            stays on as long as battery lasts (e.g. network, Home Assistant)
          </li>
          <li>
            <span className="font-medium">Ignore</span> — Excluded from
            Battery Guard, no action taken
          </li>
        </ul>
        <p className="mt-1.5 text-blue-600">
          Click &quot;Assign&quot; on each device to select a tier. All
          devices must be assigned before you can continue.
        </p>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search devices..."
        className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
      />

      {/* Unassigned */}
      {unassigned.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
            Unassigned ({unassigned.length})
          </h3>
          <div className="space-y-1">
            {unassigned.map((entity) => (
              <EntityRow
                key={entity.entity_id}
                entity={entity}
                onAssign={assignEntity}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tier columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BATTERY_GUARD_LABEL_IDS.map((tierId) => {
          const display =
            TIER_DISPLAY[tierId as keyof typeof TIER_DISPLAY]
          const tierEntities = getEntitiesForTier(tierId)

          return (
            <div
              key={tierId}
              className="border border-gray-200 rounded-lg bg-white"
            >
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{display?.emoji}</span>
                  <span className="font-medium text-sm">
                    {display?.label}
                  </span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {tierEntities.length}
                </span>
              </div>
              <div className="p-2 max-h-64 overflow-y-auto space-y-1">
                {tierEntities.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    No devices
                  </p>
                )}
                {tierEntities.map((entity) => (
                  <EntityRow
                    key={entity.entity_id}
                    entity={entity}
                    onAssign={assignEntity}
                    compact
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EntityRow({
  entity,
  onAssign,
  compact = false,
}: {
  entity: WizardEntity
  onAssign: (entityId: string, tierId: string) => void
  compact?: boolean
}) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <div
      className={`flex items-center justify-between rounded-md hover:bg-gray-50 ${
        compact ? 'px-2 py-1.5' : 'px-3 py-2 bg-white border border-gray-200'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`font-medium text-gray-900 truncate ${compact ? 'text-xs' : 'text-sm'}`}
        >
          {entity.friendly_name}
        </p>
        <p className="text-xs text-gray-400 truncate">{entity.entity_id}</p>
      </div>

      <div className="relative ml-2">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-100"
        >
          Assign
        </button>
        {showPicker && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 w-48">
            {BATTERY_GUARD_LABEL_IDS.map((tierId) => {
              const display =
                TIER_DISPLAY[tierId as keyof typeof TIER_DISPLAY]
              return (
                <button
                  key={tierId}
                  onClick={() => {
                    onAssign(entity.entity_id, tierId)
                    setShowPicker(false)
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <span>{display?.emoji}</span>
                  <span>{display?.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
