/**
 * Entity recommendation engine.
 * Suggests a Battery Guard tier based on entity domain and name patterns.
 */

interface RecommendationRule {
  /** Regex pattern to match against entity_id */
  pattern: RegExp
  /** Recommended label_id */
  tier: string
  /** Reason for the recommendation */
  reason: string
}

const RULES: RecommendationRule[] = [
  // Tier 1: Off immediately (high consumption, non-essential)
  {
    pattern: /^climate\./,
    tier: 'battery_guard_tier1',
    reason: 'HVAC systems have high power consumption',
  },
  {
    pattern: /boiler|water_heater|heater/i,
    tier: 'battery_guard_tier1',
    reason: 'Water heaters consume significant power',
  },
  {
    pattern: /wallbox|ev_charger|charging/i,
    tier: 'battery_guard_tier1',
    reason: 'EV charging draws high current',
  },
  {
    pattern: /media_player\./,
    tier: 'battery_guard_tier1',
    reason: 'Entertainment devices are non-essential',
  },

  // Tier 2: Off at low SOC (moderate consumption)
  {
    pattern: /fridge|refrigerator|freezer/i,
    tier: 'battery_guard_tier2',
    reason: 'Refrigerators can stay off for a few hours',
  },
  {
    pattern: /^light\./,
    tier: 'battery_guard_tier2',
    reason: 'Lights can be turned off to save battery',
  },
  {
    pattern: /terrasse|terrace|outdoor|aussen|garden|patio/i,
    tier: 'battery_guard_tier2',
    reason: 'Outdoor devices are non-critical',
  },

  // Tier 3: Never off (critical infrastructure)
  {
    pattern: /home_assistant|homeassistant/i,
    tier: 'battery_guard_tier3',
    reason: 'Home Assistant is the system controller',
  },
  {
    pattern: /poe|switch.*network|router|gateway|access_point/i,
    tier: 'battery_guard_tier3',
    reason: 'Network infrastructure is critical',
  },
  {
    pattern: /hue_bridge|zigbee|zwave|coordinator/i,
    tier: 'battery_guard_tier3',
    reason: 'Smart home bridges control other devices',
  },
  {
    pattern: /septic|sewage|water_pump|sump/i,
    tier: 'battery_guard_tier3',
    reason: 'Critical infrastructure must stay on',
  },
  {
    pattern: /camera|security|alarm/i,
    tier: 'battery_guard_tier3',
    reason: 'Security devices should remain active',
  },
]

export interface Recommendation {
  tier: string
  reason: string
}

/**
 * Get a tier recommendation for an entity.
 * Returns null if no recommendation can be made.
 */
export function getRecommendation(
  entityId: string,
  friendlyName: string,
): Recommendation | null {
  const searchString = `${entityId} ${friendlyName}`.toLowerCase()

  for (const rule of RULES) {
    if (rule.pattern.test(entityId) || rule.pattern.test(searchString)) {
      return { tier: rule.tier, reason: rule.reason }
    }
  }

  return null
}
