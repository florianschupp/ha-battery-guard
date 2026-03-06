import { listEntities, updateEntity, getStates } from './ha-websocket'
import {
  TRACKED_DOMAINS,
  BATTERY_GUARD_LABEL_IDS,
  LABEL_MIGRATION_MAP,
} from '../lib/constants'
import { getRecommendation } from '../lib/entity-recommendations'
import type { WizardEntity, TierAssignment } from '../types/wizard-types'

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

/** Get current tier assignments from entity labels */
export function getCurrentAssignments(
  entities: WizardEntity[],
): TierAssignment {
  const assignments: TierAssignment = {}

  for (const entity of entities) {
    // Check for current English labels
    const currentLabel = entity.labels.find((l) =>
      BATTERY_GUARD_LABEL_IDS.includes(l),
    )
    if (currentLabel) {
      assignments[entity.entity_id] = currentLabel
      continue
    }

    // Check for legacy German labels and migrate
    const legacyLabel = entity.labels.find((l) => l in LABEL_MIGRATION_MAP)
    if (legacyLabel) {
      assignments[entity.entity_id] = LABEL_MIGRATION_MAP[legacyLabel]
    }
  }

  return assignments
}

/**
 * Apply tier assignments to entities via the HA entity registry.
 * Preserves non-Battery-Guard labels on each entity.
 */
export async function applyAssignments(
  entities: WizardEntity[],
  assignments: TierAssignment,
): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  for (const entity of entities) {
    const newTier = assignments[entity.entity_id]
    if (!newTier) continue

    // Preserve labels that aren't Battery Guard related
    const preservedLabels = entity.labels.filter(
      (l) =>
        !BATTERY_GUARD_LABEL_IDS.includes(l) && !(l in LABEL_MIGRATION_MAP),
    )

    const newLabels = [...preservedLabels, newTier]

    try {
      await updateEntity(entity.entity_id, { labels: newLabels })
      success++
    } catch {
      failed.push(entity.entity_id)
    }
  }

  return { success, failed }
}
