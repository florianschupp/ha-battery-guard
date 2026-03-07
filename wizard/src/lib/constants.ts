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

/**
 * Available actions per domain.
 * Mirrors DOMAIN_ACTIONS in Python const.py.
 */
export const DOMAIN_ACTIONS: Record<string, { value: string; label: string }[]> = {
  switch: [
    { value: 'turn_off', label: 'Turn off' },
  ],
  climate: [
    { value: 'set_hvac_mode', label: 'Set HVAC mode' },
    { value: 'set_temperature', label: 'Set temperature' },
    { value: 'turn_off', label: 'Turn off' },
  ],
  light: [
    { value: 'dim', label: 'Dim' },
    { value: 'turn_off', label: 'Turn off' },
  ],
  media_player: [
    { value: 'turn_off', label: 'Turn off' },
  ],
}

/** HVAC modes for climate action config */
export const HVAC_MODES = [
  { value: 'fan_only', label: 'Fan only' },
  { value: 'heat', label: 'Heat' },
  { value: 'cool', label: 'Cool' },
  { value: 'auto', label: 'Auto' },
  { value: 'dry', label: 'Dry' },
  { value: 'off', label: 'Off' },
]

/** Tier display info */
export const TIER_DISPLAY = {
  battery_guard_tier1: {
    label: 'Tier 1 — Off Immediately',
    color: 'red',
    description: 'HVAC, water heaters, TV, EV charger',
  },
  battery_guard_tier2: {
    label: 'Tier 2 — Off at Low Battery',
    color: 'orange',
    description: 'Refrigerators, lights, non-critical switches',
  },
  battery_guard_tier3: {
    label: 'Tier 3 — Never Turn Off',
    color: 'green',
    description: 'Home Assistant, network, critical infrastructure',
  },
  battery_guard_ignore: {
    label: 'Ignore',
    color: 'grey',
    description: 'Excluded from monitoring',
  },
} as const
