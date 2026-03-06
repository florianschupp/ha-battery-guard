import { listLabels, createLabel, deleteLabel } from './ha-websocket'
import {
  BATTERY_GUARD_LABELS,
  LEGACY_GERMAN_LABELS,
  LABEL_MIGRATION_MAP,
} from '../lib/constants'
import type { HALabel } from '../types/ha-types'

export interface LabelStatus {
  labelId: string
  name: string
  exists: boolean
  legacyExists: boolean
  legacyLabelId: string | null
}

/** Check the status of all Battery Guard labels */
export async function checkLabelStatus(): Promise<LabelStatus[]> {
  const existingLabels = await listLabels()
  const existingIds = new Set(existingLabels.map((l) => l.label_id))

  return Object.values(BATTERY_GUARD_LABELS).map((label) => {
    const legacyId = Object.entries(LABEL_MIGRATION_MAP).find(
      ([, v]) => v === label.label_id,
    )?.[0]

    return {
      labelId: label.label_id,
      name: label.name,
      exists: existingIds.has(label.label_id),
      legacyExists: legacyId ? existingIds.has(legacyId) : false,
      legacyLabelId: legacyId ?? null,
    }
  })
}

/** Create all missing Battery Guard labels */
export async function createMissingLabels(): Promise<HALabel[]> {
  const statuses = await checkLabelStatus()
  const created: HALabel[] = []

  for (const status of statuses) {
    if (!status.exists) {
      const def = Object.values(BATTERY_GUARD_LABELS).find(
        (l) => l.label_id === status.labelId,
      )
      if (def) {
        const label = await createLabel({
          name: def.name,
          color: def.color,
          icon: def.icon,
          description: def.description,
        })
        created.push(label)
      }
    }
  }

  return created
}

/** Check if legacy German labels exist */
export async function hasLegacyLabels(): Promise<boolean> {
  const existingLabels = await listLabels()
  const existingIds = new Set(existingLabels.map((l) => l.label_id))
  return LEGACY_GERMAN_LABELS.some((id) => existingIds.has(id))
}

/** Delete legacy German labels (after migration) */
export async function deleteLegacyLabels(): Promise<void> {
  const existingLabels = await listLabels()
  const existingIds = new Set(existingLabels.map((l) => l.label_id))

  for (const legacyId of LEGACY_GERMAN_LABELS) {
    if (existingIds.has(legacyId)) {
      await deleteLabel(legacyId)
    }
  }
}
