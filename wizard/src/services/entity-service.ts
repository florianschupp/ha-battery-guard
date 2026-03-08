import { listAreas, listEntities, updateEntity, getStates, getDeviceActions, getRestoreConfig } from './ha-websocket'
import {
  TRACKED_DOMAINS,
  BATTERY_GUARD_LABEL_IDS,
  LABEL_MIGRATION_MAP,
  DEFAULT_RESTORE_CONFIG,
} from '../lib/constants'
import { getRecommendation } from '../lib/entity-recommendations'
import type { WizardEntity, TierAssignment, DeviceActions, RestoreConfig } from '../types/wizard-types'

/** Battery Guard integration domain — used to filter out own entities */
const BATTERY_GUARD_PLATFORM = 'battery_guard'

/** Fetch all switchable entities with their current tier assignments */
export async function discoverEntities(): Promise<WizardEntity[]> {
  const [registryEntries, states] = await Promise.all([
    listEntities(),
    getStates(),
  ])

  const stateMap = new Map<string, { friendly_name: string }>();
  if (Array.isArray(states)) {
    for (const s of states as Array<{ entity_id: string; attributes: { friendly_name?: string } }>) {
      stateMap.set(s.entity_id, {
        friendly_name: s.attributes?.friendly_name || s.entity_id,
      })
    }
  }

  return registryEntries
    .filter((entry) => {
      // Exclude Battery Guard's own entities
      if (entry.platform === BATTERY_GUARD_PLATFORM) return false
      // Exclude config and diagnostic entities (not controllable devices)
      if (entry.entity_category === 'config' || entry.entity_category === 'diagnostic') return false
      const domain = entry.entity_id.split('.')[0]
      return (TRACKED_DOMAINS as readonly string[]).includes(domain)
    })
    .filter((entry) => !entry.disabled_by)
    .map((entry) => {
      const domain = entry.entity_id.split('.')[0]
      const stateInfo = stateMap.get(entry.entity_id)
      const friendlyName =
        entry.name ||
        entry.original_name ||
        stateInfo?.friendly_name ||
        entry.entity_id

      const recommendation = getRecommendation(entry.entity_id, friendlyName)

      return {
        ...entry,
        domain,
        friendly_name: friendlyName,
        recommended_tier: recommendation?.tier ?? null,
      }
    })
    .sort((a, b) => {
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain)
      return a.friendly_name.localeCompare(b.friendly_name)
    })
}

/**
 * Fetch all areas and return a map of area_id -> area name.
 * Returns empty object if area registry is unavailable.
 */
export async function discoverAreas(): Promise<Record<string, string>> {
  try {
    const areas = await listAreas()
    return Object.fromEntries(areas.map((a) => [a.area_id, a.name]))
  } catch {
    return {}
  }
}

/**
 * Get current tier assignments from entity labels.
 * Returns multi-label assignments (entity can be in T1 + T2).
 */
export function getCurrentAssignments(
  entities: WizardEntity[],
): TierAssignment {
  const assignments: TierAssignment = {}

  for (const entity of entities) {
    const labels: string[] = []

    // Check for current English labels
    for (const l of entity.labels) {
      if (BATTERY_GUARD_LABEL_IDS.includes(l)) {
        labels.push(l)
      } else if (l in LABEL_MIGRATION_MAP) {
        // Legacy German label → migrate to English
        labels.push(LABEL_MIGRATION_MAP[l])
      }
    }

    if (labels.length > 0) {
      assignments[entity.entity_id] = labels
    }
  }

  return assignments
}

/**
 * Load device actions from the integration's config entry.
 * Returns empty object if the WebSocket command is not available (pre-v2.0.0).
 */
export async function loadDeviceActions(): Promise<DeviceActions> {
  try {
    return (await getDeviceActions()) as DeviceActions
  } catch {
    // Integration might not support this command yet (pre-v2.0.0)
    return {}
  }
}

/**
 * Load restore configuration from the integration's config entry.
 * Returns defaults if the WebSocket command is not available.
 */
export async function loadRestoreConfig(): Promise<RestoreConfig> {
  try {
    return await getRestoreConfig()
  } catch {
    return DEFAULT_RESTORE_CONFIG
  }
}

/**
 * Apply tier assignment for a single entity.
 * Preserves non-Battery-Guard labels.
 */
export async function applySingleAssignment(
  entity: WizardEntity,
  newTiers: string[],
): Promise<void> {
  const preservedLabels = entity.labels.filter(
    (l) =>
      !BATTERY_GUARD_LABEL_IDS.includes(l) && !(l in LABEL_MIGRATION_MAP),
  )
  await updateEntity(entity.entity_id, {
    labels: [...preservedLabels, ...newTiers],
  })
}

/**
 * Apply tier assignments to entities via the HA entity registry.
 * Supports multi-label: an entity can have multiple Battery Guard labels.
 * Preserves non-Battery-Guard labels on each entity.
 */
export async function applyAssignments(
  entities: WizardEntity[],
  assignments: TierAssignment,
): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  for (const entity of entities) {
    const newTiers = assignments[entity.entity_id]
    if (!newTiers || newTiers.length === 0) continue

    // Preserve labels that aren't Battery Guard related
    const preservedLabels = entity.labels.filter(
      (l) =>
        !BATTERY_GUARD_LABEL_IDS.includes(l) && !(l in LABEL_MIGRATION_MAP),
    )

    const newLabels = [...preservedLabels, ...newTiers]

    try {
      await updateEntity(entity.entity_id, { labels: newLabels })
      success++
    } catch {
      failed.push(entity.entity_id)
    }
  }

  return { success, failed }
}
