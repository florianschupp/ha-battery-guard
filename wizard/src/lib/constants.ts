/** Battery Guard label definitions */
export const BATTERY_GUARD_LABELS = {
  tier1: {
    label_id: 'battery_guard_tier1',
    name: 'Battery Guard: Tier 1',
    color: 'red',
    icon: 'mdi:flash-off',
    description: 'Devices turned off immediately during power outage',
  },
  tier2: {
    label_id: 'battery_guard_tier2',
    name: 'Battery Guard: Tier 2',
    color: 'orange',
    icon: 'mdi:battery-alert-variant-outline',
    description: 'Devices turned off when battery drops below threshold',
  },
  tier3: {
    label_id: 'battery_guard_tier3',
    name: 'Battery Guard: Tier 3',
    color: 'green',
    icon: 'mdi:shield-check',
    description: 'Critical devices that are never turned off',
  },
  ignore: {
    label_id: 'battery_guard_ignore',
    name: 'Battery Guard: Ignore',
    color: 'grey',
    icon: 'mdi:eye-off',
    description: 'Devices excluded from Battery Guard monitoring',
  },
} as const

/** All Battery Guard label IDs */
export const BATTERY_GUARD_LABEL_IDS: string[] = Object.values(
  BATTERY_GUARD_LABELS,
).map((l) => l.label_id)

/** Legacy German label IDs (for migration detection) */
export const LEGACY_GERMAN_LABELS = [
  'notstrom_stufe1',
  'notstrom_stufe2',
  'notstrom_stufe3',
  'notstrom_ignorieren',
]

/** Mapping from German to English labels */
export const LABEL_MIGRATION_MAP: Record<string, string> = {
  notstrom_stufe1: 'battery_guard_tier1',
  notstrom_stufe2: 'battery_guard_tier2',
  notstrom_stufe3: 'battery_guard_tier3',
  notstrom_ignorieren: 'battery_guard_ignore',
}

/** Entity domains tracked by Battery Guard */
export const TRACKED_DOMAINS = [
  'switch',
  'climate',
  'light',
  'media_player',
] as const

/** Default SOC thresholds */
export const DEFAULT_TIER2_THRESHOLD = 30
export const DEFAULT_TIER2_RECOVERY_THRESHOLD = 40

/** Tier display info */
export const TIER_DISPLAY = {
  battery_guard_tier1: {
    label: 'Tier 1 — Off Immediately',
    color: 'red',
    emoji: '🔴',
    description: 'HVAC, water heaters, TV, EV charger',
  },
  battery_guard_tier2: {
    label: 'Tier 2 — Off at Low Battery',
    color: 'orange',
    emoji: '🟡',
    description: 'Refrigerators, lights, non-critical switches',
  },
  battery_guard_tier3: {
    label: 'Tier 3 — Never Turn Off',
    color: 'green',
    emoji: '🟢',
    description: 'Home Assistant, network, critical infrastructure',
  },
  battery_guard_ignore: {
    label: 'Ignore',
    color: 'grey',
    emoji: '⚪',
    description: 'Excluded from monitoring',
  },
} as const
