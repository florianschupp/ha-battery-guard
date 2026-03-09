import { useCallback, useEffect, useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import {
  discoverEntities,
  discoverAreas,
  getCurrentAssignments,
  loadDeviceActions,
  loadRestoreConfig,
  applySingleAssignment,
} from '../services/entity-service'
import {
  setDeviceActions as saveDeviceActions,
  setRestoreConfig as saveRestoreConfig,
} from '../services/ha-websocket'
import {
  DOMAIN_ACTIONS,
  HVAC_MODES,
} from '../lib/constants'
import type { ActionConfig, WizardEntity } from '../types/wizard-types'

/** Domain-specific fallback SVG icon */
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

/**
 * Entity icon — renders the HA entity icon via Iconify CDN.
 * Falls back to DomainIcon if no icon is set or the image fails to load.
 */
function EntityIcon({
  icon,
  domain,
  className,
}: {
  icon: string | null
  domain: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const cls = className || 'w-4 h-4'

  if (!icon || failed) {
    return <DomainIcon domain={domain} className={className} />
  }

  // Parse "mdi:icon-name" → "icon-name"
  const parts = icon.split(':')
  const prefix = parts.length > 1 ? parts[0] : 'mdi'
  const name = parts.length > 1 ? parts[1] : parts[0]

  return (
    <img
      src={`https://api.iconify.design/${prefix}/${name}.svg?color=%239ca3af`}
      alt=""
      className={`${cls} shrink-0`}
      onError={() => setFailed(true)}
    />
  )
}

/** Battery level icon for tier section headers */
function BatteryIcon({ level, fillColor, className }: { level: 1 | 2 | 3; fillColor: string; className?: string }) {
  const cls = className || 'w-5 h-5'
  const fills = { 1: { y: 16, h: 3 }, 2: { y: 12, h: 7 }, 3: { y: 6, h: 13 } }
  const { y, h } = fills[level]

  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none">
      <rect x="6" y="4" width="12" height="16" rx="1.5" stroke="currentColor" strokeWidth={1.5} />
      <rect x="9.5" y="1.5" width="5" height="2.5" rx="0.75" stroke="currentColor" strokeWidth={1.5} />
      <rect x="7.5" y={y} width="9" height={h} rx="0.5" fill={fillColor} />
    </svg>
  )
}

/** Severity score for sorting within a tier (higher = more disruptive) */
function getActionSeverity(action: ActionConfig | undefined): number {
  if (!action) return 0
  switch (action.action) {
    case 'turn_off':
      return 10
    case 'set_hvac_mode':
      return (action.hvac_mode ?? 'off') === 'off' ? 9 : 3
    case 'dim':
      return 5
    case 'set_temperature':
      return 4
    case 'turn_on':
      return 0
    default:
      return 1
  }
}

/** Action icon SVG based on action type */
function ActionIcon({ action }: { action: ActionConfig }) {
  const cls = 'w-3.5 h-3.5 shrink-0'

  switch (action.action) {
    case 'turn_off':
    case 'turn_on':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 11-12.728 0M12 3v9" />
        </svg>
      )
    case 'set_hvac_mode': {
      const mode = action.hvac_mode ?? 'off'
      if (mode === 'off')
        return (
          <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 11-12.728 0M12 3v9" />
          </svg>
        )
      if (mode === 'fan_only')
        return (
          <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2" />
          </svg>
        )
      if (mode === 'heat')
        return (
          <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21a8.25 8.25 0 01-6.038-2.585M15.362 5.214A8.21 8.21 0 0112 4.5c-2.135 0-4.085.81-5.55 2.14M15.362 5.214l.344.637" />
            <path strokeLinecap="round" d="M12 9v4" />
          </svg>
        )
      if (mode === 'cool')
        return (
          <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-18l4 4m-4-4L8 7m4 14l4-4m-4 4l-4-4M3 12h18M3 12l4-4m-4 4l4 4m14-4l-4-4m4 4l-4 4" />
          </svg>
        )
      if (mode === 'dry')
        return (
          <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21.5c-3.6 0-6.5-2.8-6.5-6.3 0-4.2 6.5-12.7 6.5-12.7s6.5 8.5 6.5 12.7c0 3.5-2.9 6.3-6.5 6.3z" />
          </svg>
        )
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
        </svg>
      )
    }
    case 'dim':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      )
    case 'set_temperature':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13m0 0a4 4 0 110 0zm0 0V3M8 12a4 4 0 004 8 4 4 0 004-8" />
          <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
        </svg>
      )
    default:
      return null
  }
}

/** Color class based on action severity */
function getActionColor(action: ActionConfig): string {
  switch (action.action) {
    case 'turn_off':
      return 'text-rose-500'
    case 'turn_on':
      return 'text-emerald-500'
    case 'set_hvac_mode': {
      const mode = action.hvac_mode ?? 'off'
      if (mode === 'off') return 'text-rose-500'
      if (mode === 'fan_only') return 'text-cyan-600'
      if (mode === 'heat') return 'text-orange-500'
      if (mode === 'cool') return 'text-sky-500'
      if (mode === 'dry') return 'text-indigo-400'
      return 'text-slate-500'
    }
    case 'dim':
      return 'text-amber-500'
    case 'set_temperature':
      return 'text-blue-500'
    default:
      return 'text-gray-500'
  }
}

/** Human-readable action label */
function getActionLabel(action: ActionConfig): string {
  switch (action.action) {
    case 'turn_off':
      return 'Turn off'
    case 'turn_on':
      return 'Turn on'
    case 'set_hvac_mode': {
      const mode = String(action.hvac_mode ?? 'off')
      if (mode === 'fan_only') return 'Fan only'
      if (mode === 'off') return 'HVAC off'
      return mode.charAt(0).toUpperCase() + mode.slice(1)
    }
    case 'dim':
      return `Dim ${action.brightness_pct ?? '?'}%`
    case 'set_temperature':
      return `${action.temperature ?? '?'}°C`
    default:
      return action.action
  }
}

/** Entity card component */
function EntityCard({
  entity,
  actionConfig,
  restoreMode,
  showAction,
  areaName,
  onClick,
}: {
  entity: WizardEntity
  actionConfig: ActionConfig
  restoreMode: string
  showAction: boolean
  areaName: string | null
  onClick?: () => void
}) {
  const colorClass = getActionColor(actionConfig)

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 flex flex-col gap-1.5 cursor-pointer hover:border-gray-300 hover:shadow transition-all"
    >
      <div className="flex items-start gap-2 min-w-0">
        <EntityIcon
          icon={entity.icon}
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
        {showAction ? (
          <span className={`flex items-center gap-1 ${colorClass} truncate`}>
            <ActionIcon action={actionConfig} />
            <span className="truncate">{getActionLabel(actionConfig)}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-emerald-500 truncate">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="truncate">Protected</span>
          </span>
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

// ============================================================================
// Tier helpers & pill button (shared with modal)
// ============================================================================

const TIER_PILLS = [
  { id: 'battery_guard_tier1', short: 'T1' },
  { id: 'battery_guard_tier2', short: 'T2' },
  { id: 'battery_guard_tier3', short: 'T3' },
  { id: 'battery_guard_ignore', short: '\u2014' },
] as const

function isActionTier(tierId: string): boolean {
  return tierId === 'battery_guard_tier1' || tierId === 'battery_guard_tier2'
}

function tierToActionKey(tierId: string): 'tier1' | 'tier2' {
  return tierId === 'battery_guard_tier1' ? 'tier1' : 'tier2'
}

function hasConfigurableActions(domain: string): boolean {
  const actions = DOMAIN_ACTIONS[domain]
  return !!actions && actions.length > 1
}

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
      className={`w-10 h-9 rounded-md text-xs font-bold transition-all ${
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

/** Inline action config dropdowns */
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
    <div className="flex items-center gap-2 text-sm">
      <span className={`font-bold ${tierColor} shrink-0`}>{tierLabel}:</span>
      <select
        value={action.action}
        onChange={(e) => {
          const newAction: ActionConfig = { action: e.target.value }
          if (e.target.value === 'set_hvac_mode') newAction.hvac_mode = 'fan_only'
          else if (e.target.value === 'dim') newAction.brightness_pct = 20
          else if (e.target.value === 'set_temperature') newAction.temperature = 18
          onChange(newAction)
        }}
        className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
      >
        {actions.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>

      {action.action === 'set_hvac_mode' && (
        <select
          value={String(action.hvac_mode || 'fan_only')}
          onChange={(e) => onChange({ ...action, hvac_mode: e.target.value })}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
        >
          {HVAC_MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}

      {action.action === 'set_temperature' && (
        <div className="flex items-center gap-1">
          <input
            type="number" min={10} max={35} step={0.5}
            value={Number(action.temperature) || 18}
            onChange={(e) => onChange({ ...action, temperature: parseFloat(e.target.value) })}
            className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
          />
          <span className="text-gray-400 text-sm">\u00b0C</span>
        </div>
      )}

      {action.action === 'dim' && (
        <div className="flex items-center gap-1">
          <input
            type="number" min={1} max={100}
            value={Number(action.brightness_pct) || 20}
            onChange={(e) => onChange({ ...action, brightness_pct: parseInt(e.target.value, 10) })}
            className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
          />
          <span className="text-gray-400 text-sm">%</span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Entity Edit Modal
// ============================================================================

function EntityEditModal({
  entity,
  areaName,
  initialTiers,
  initialActions,
  initialRestoreConfig,
  onSave,
  onClose,
}: {
  entity: WizardEntity
  areaName: string | null
  initialTiers: string[]
  initialActions: Record<string, ActionConfig>
  initialRestoreConfig: { stayOff: boolean; customDelay: number | null }
  onSave: (tiers: string[], actions: Record<string, ActionConfig>, restoreMode: { stayOff: boolean; customDelay: number | null }) => Promise<void>
  onClose: () => void
}) {
  const [tiers, setTiers] = useState<string[]>(initialTiers)
  const [actions, setActions] = useState<Record<string, ActionConfig>>(initialActions)
  const [restoreMode, setRestoreMode] = useState<'standard' | 'stay_off' | 'custom'>(
    initialRestoreConfig.stayOff ? 'stay_off' : initialRestoreConfig.customDelay !== null ? 'custom' : 'standard'
  )
  const [customDelay, setCustomDelay] = useState(initialRestoreConfig.customDelay ?? 30)
  const [saving, setSaving] = useState(false)

  function toggleTier(tierId: string) {
    setTiers((prev) => {
      if (isActionTier(tierId)) {
        const withoutExclusive = prev.filter(
          (t) => t !== 'battery_guard_tier3' && t !== 'battery_guard_ignore',
        )
        if (withoutExclusive.includes(tierId)) {
          const newTiers = withoutExclusive.filter((t) => t !== tierId)
          // Clear action for removed tier
          setActions((a) => {
            const next = { ...a }
            delete next[tierToActionKey(tierId)]
            return next
          })
          return newTiers
        }
        // Add tier with default action
        setActions((a) => ({ ...a, [tierToActionKey(tierId)]: { action: 'turn_off' } }))
        return [...withoutExclusive, tierId]
      }
      // Exclusive tiers (T3, Ignore)
      if (prev.length === 1 && prev[0] === tierId) return []
      setActions({}) // Clear all actions
      return [tierId]
    })
  }

  const activeTiers = tiers.filter(isActionTier)
  const showActions = hasConfigurableActions(entity.domain) && activeTiers.length > 0

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(
        tiers,
        actions,
        {
          stayOff: restoreMode === 'stay_off',
          customDelay: restoreMode === 'custom' ? customDelay : null,
        },
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <EntityIcon icon={entity.icon} domain={entity.domain} className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 truncate">
                {entity.friendly_name}
              </h3>
              {areaName && (
                <p className="text-xs text-gray-400">{areaName}</p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 -mt-1 -mr-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100" />

        {/* Tier selection */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 block">
              Tier
            </label>
            <div className="flex gap-1.5">
              {TIER_PILLS.map((pill) => (
                <TierPillButton
                  key={pill.id}
                  pillId={pill.id}
                  short={pill.short}
                  isActive={tiers.includes(pill.id)}
                  onClick={() => toggleTier(pill.id)}
                />
              ))}
            </div>
          </div>

          {/* Action config */}
          {showActions && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 block">
                Actions
              </label>
              <div className="space-y-2">
                {activeTiers.map((tierId) => {
                  const actionKey = tierToActionKey(tierId)
                  const currentAction = actions[actionKey] || { action: 'turn_off' }
                  const tierLabel = tierId === 'battery_guard_tier1' ? 'T1' : 'T2'
                  const tierColor = tierId === 'battery_guard_tier1' ? 'text-red-600' : 'text-amber-600'
                  return (
                    <ActionConfigRow
                      key={tierId}
                      domain={entity.domain}
                      tierLabel={tierLabel}
                      tierColor={tierColor}
                      action={currentAction}
                      onChange={(action) => setActions((a) => ({ ...a, [actionKey]: action }))}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {/* Restore mode */}
          {tiers.some(isActionTier) && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 block">
                Restore
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="restore" value="standard"
                    checked={restoreMode === 'standard'}
                    onChange={() => setRestoreMode('standard')}
                    className="text-blue-500"
                  />
                  <span className="text-sm text-gray-700">Standard</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="restore" value="stay_off"
                    checked={restoreMode === 'stay_off'}
                    onChange={() => setRestoreMode('stay_off')}
                    className="text-blue-500"
                  />
                  <span className="text-sm text-gray-700">Do Not Restore</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="restore" value="custom"
                    checked={restoreMode === 'custom'}
                    onChange={() => setRestoreMode('custom')}
                    className="text-blue-500"
                  />
                  <span className="text-sm text-gray-700">Custom Delay</span>
                  {restoreMode === 'custom' && (
                    <div className="flex items-center gap-1 ml-1">
                      <input
                        type="number" min={0} max={600} step={5}
                        value={customDelay}
                        onChange={(e) => setCustomDelay(parseInt(e.target.value, 10) || 0)}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-sm bg-white"
                      />
                      <span className="text-xs text-gray-400">s</span>
                    </div>
                  )}
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100" />

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="py-2 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || tiers.length === 0}
            className="py-2 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
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
    subtitle: 'These appliances are switched immediately when a power outage is detected.',
    batteryLevel: 3 as const,
    batteryColor: '#f43f5e',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier2',
    key: 'tier2',
    title: 'Tier 2',
    label: 'Low Battery',
    subtitle: 'These appliances are switched when battery drops below the configured threshold.',
    batteryLevel: 2 as const,
    batteryColor: '#f59e0b',
    showActions: true,
  },
  {
    tierId: 'battery_guard_tier3',
    key: 'tier3',
    title: 'Tier 3',
    label: 'Critical Infrastructure',
    subtitle: 'These appliances are never turned off and run until total power loss.',
    batteryLevel: 1 as const,
    batteryColor: '#10b981',
    showActions: false,
  },
] as const

export function DashboardView() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [loading, setLoading] = useState(true)
  const [editEntity, setEditEntity] = useState<WizardEntity | null>(null)

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
                <BatteryIcon
                  level={section.batteryLevel}
                  fillColor={section.batteryColor}
                  className="w-5 h-5 text-gray-500"
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
              <p className="text-xs text-gray-400 mb-3 ml-[30px]">
                {section.subtitle}
              </p>

              {entities.length === 0 ? (
                <p className="text-sm text-gray-400 ml-[30px]">
                  No devices assigned.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {[...entities]
                    .sort((a, b) => {
                      if (!section.showActions) return 0
                      const tierKey = section.key as 'tier1' | 'tier2'
                      const actionA = config.deviceActions[a.entity_id]?.[tierKey] || { action: 'turn_off' }
                      const actionB = config.deviceActions[b.entity_id]?.[tierKey] || { action: 'turn_off' }
                      return getActionSeverity(actionB) - getActionSeverity(actionA)
                    })
                    .map((entity) => {
                      const tierKey = section.key as 'tier1' | 'tier2'
                      const actionConfig: ActionConfig = section.showActions
                        ? config.deviceActions[entity.entity_id]?.[tierKey] || { action: 'turn_off' }
                        : { action: 'turn_off' }
                      const areaName = entity.area_id
                        ? config.areas[entity.area_id] || null
                        : null

                      return (
                        <EntityCard
                          key={entity.entity_id}
                          entity={entity}
                          actionConfig={actionConfig}
                          restoreMode={getRestoreMode(entity.entity_id)}
                          showAction={section.showActions}
                          areaName={areaName}
                          onClick={() => setEditEntity(entity)}
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

      {/* Inline edit modal */}
      {editEntity && (
        <EntityEditModal
          entity={editEntity}
          areaName={editEntity.area_id ? config.areas[editEntity.area_id] || null : null}
          initialTiers={config.assignments[editEntity.entity_id] || []}
          initialActions={config.deviceActions[editEntity.entity_id] || {}}
          initialRestoreConfig={{
            stayOff: config.restoreConfig.stay_off.includes(editEntity.entity_id),
            customDelay: config.restoreConfig.device_delays?.[editEntity.entity_id] ?? null,
          }}
          onSave={async (newTiers, newActions, restoreOpts) => {
            const entityId = editEntity.entity_id

            // 1. Update entity labels in HA
            await applySingleAssignment(editEntity, newTiers)

            // 2. Update device actions
            const updatedDeviceActions = { ...config.deviceActions }
            if (Object.keys(newActions).length > 0) {
              updatedDeviceActions[entityId] = newActions
            } else {
              delete updatedDeviceActions[entityId]
            }
            dispatch({ type: 'SET_DEVICE_ACTIONS', deviceActions: updatedDeviceActions })
            try { await saveDeviceActions(updatedDeviceActions) } catch { /* pre-v2 */ }

            // 3. Update restore config
            const updatedRestoreConfig = { ...config.restoreConfig }
            // Handle stay_off
            const stayOffSet = new Set(updatedRestoreConfig.stay_off)
            if (restoreOpts.stayOff) {
              stayOffSet.add(entityId)
            } else {
              stayOffSet.delete(entityId)
            }
            updatedRestoreConfig.stay_off = [...stayOffSet]
            // Handle custom delay
            const delays = { ...updatedRestoreConfig.device_delays }
            if (restoreOpts.customDelay !== null) {
              delays[entityId] = restoreOpts.customDelay
            } else {
              delete delays[entityId]
            }
            updatedRestoreConfig.device_delays = delays
            dispatch({ type: 'SET_RESTORE_CONFIG', restoreConfig: updatedRestoreConfig })
            try { await saveRestoreConfig(updatedRestoreConfig) } catch { /* pre-v2 */ }

            // 4. Close modal and reload data
            setEditEntity(null)
            loadAllData()
          }}
          onClose={() => setEditEntity(null)}
        />
      )}
    </div>
  )
}
