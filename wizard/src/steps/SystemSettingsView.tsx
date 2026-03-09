import { useEffect, useRef, useState } from 'react'
import { useStatus } from '../hooks/useStatus'
import { getConfig, getDeviceActions, setConfig, getRestoreConfig, setRestoreConfig as saveRestoreConfig } from '../services/ha-websocket'
import { discoverEntities } from '../services/entity-service'
import { TIER_DISPLAY, DEFAULT_RESTORE_CONFIG } from '../lib/constants'
import type { DeviceActions, RestoreConfig, WizardEntity } from '../types/wizard-types'

interface SystemConfig {
  tier2_threshold: number
  recovery_threshold: number
  critical_soc: number
  battery_max_soc: number
  battery_min_soc: number
  notify_services: string[]
}

/** Human-readable labels for device actions */
const ACTION_LABELS: Record<string, string> = {
  turn_off: 'off',
  turn_on: 'on',
  set_hvac_mode: 'mode switch',
  set_temperature: 'temp adjust',
  dim: 'dimmed',
}

interface TierStat {
  total: number
  actions: Record<string, number>
}

interface TierStats {
  tier1: TierStat
  tier2: TierStat
  tier3: TierStat
}

const EMPTY_TIER_STATS: TierStats = {
  tier1: { total: 0, actions: {} },
  tier2: { total: 0, actions: {} },
  tier3: { total: 0, actions: {} },
}

/** Compute per-tier device counts and action breakdowns */
function computeTierStats(
  entities: { entity_id: string; labels: string[] }[],
  deviceActions: DeviceActions,
): TierStats {
  const stats: TierStats = {
    tier1: { total: 0, actions: {} },
    tier2: { total: 0, actions: {} },
    tier3: { total: 0, actions: {} },
  }

  for (const entity of entities) {
    if (entity.labels.includes('battery_guard_tier1')) {
      stats.tier1.total++
      const action = deviceActions[entity.entity_id]?.tier1?.action ?? 'turn_off'
      const label = ACTION_LABELS[action] ?? action
      stats.tier1.actions[label] = (stats.tier1.actions[label] ?? 0) + 1
    }
    if (entity.labels.includes('battery_guard_tier2')) {
      stats.tier2.total++
      const action = deviceActions[entity.entity_id]?.tier2?.action ?? 'turn_off'
      const label = ACTION_LABELS[action] ?? action
      stats.tier2.actions[label] = (stats.tier2.actions[label] ?? 0) + 1
    }
    if (entity.labels.includes('battery_guard_tier3')) {
      stats.tier3.total++
    }
  }

  return stats
}

/** Format tier stat into a compact summary string */
function formatTierSummary(stat: TierStat, isCritical = false): string {
  if (stat.total === 0) return 'No devices assigned'
  if (isCritical) {
    return `${stat.total} device${stat.total !== 1 ? 's' : ''} (always active)`
  }
  const parts = Object.entries(stat.actions)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => `${count}× ${label}`)
  return `${stat.total} device${stat.total !== 1 ? 's' : ''} — ${parts.join(', ')}`
}

const DEFAULT_CONFIG: SystemConfig = {
  tier2_threshold: 30,
  recovery_threshold: 40,
  critical_soc: 10,
  battery_max_soc: 100,
  battery_min_soc: 0,
  notify_services: [],
}

/** Tier keys in restore order with display config */
const RESTORE_TIERS = [
  { key: 'tier3', label: 'Tier 3', tierId: 'battery_guard_tier3' },
  { key: 'tier2', label: 'Tier 2', tierId: 'battery_guard_tier2' },
  { key: 'tier1', label: 'Tier 1', tierId: 'battery_guard_tier1' },
] as const

export function SystemSettingsView() {
  const [config, setLocalConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [tierStats, setTierStats] = useState<TierStats>(EMPTY_TIER_STATS)
  const [entities, setEntities] = useState<WizardEntity[]>([])
  const [restoreConfig, setLocalRestoreConfig] = useState<RestoreConfig>(DEFAULT_RESTORE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { soc, isOutage, isActive } = useStatus()
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    let cancelled = false

    // Fetch config, entities, device actions, and restore config in parallel
    Promise.all([
      getConfig().catch(() => null),
      discoverEntities().catch(() => [] as WizardEntity[]),
      getDeviceActions().catch(() => ({})),
      getRestoreConfig().catch(() => DEFAULT_RESTORE_CONFIG),
    ]).then(([configData, discoveredEntities, deviceActions, restoreData]) => {
      if (cancelled) return
      if (configData) setLocalConfig(configData as unknown as SystemConfig)
      const typedActions = deviceActions as DeviceActions
      setTierStats(computeTierStats(discoveredEntities, typedActions))
      setEntities(discoveredEntities)
      setLocalRestoreConfig(restoreData)
    }).finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setError(null)
    setSaved(false)

    // Validate
    if (config.recovery_threshold <= config.tier2_threshold) {
      setError('Recovery threshold must be higher than T2 threshold.')
      return
    }
    if (config.critical_soc >= config.tier2_threshold) {
      setError('Critical SOC must be lower than T2 threshold.')
      return
    }

    setSaving(true)
    try {
      await Promise.all([
        setConfig({
          tier2_threshold: config.tier2_threshold,
          recovery_threshold: config.recovery_threshold,
          critical_soc: config.critical_soc,
          battery_max_soc: config.battery_max_soc,
          battery_min_soc: config.battery_min_soc,
          notify_services: config.notify_services,
        }),
        saveRestoreConfig(restoreConfig),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Outage Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure battery thresholds and device restore behavior during power outages.
        </p>
      </div>

      {/* Power Outage Stages */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Power Outage Stages
          </h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 mb-5">
            During a power outage, Tier 1 actions execute immediately. As the battery drains, further
            stages activate. Actions can include turning off, dimming, or switching device modes.
          </p>

          <BatteryStageSlider
            critical={config.critical_soc}
            tier2={config.tier2_threshold}
            recovery={config.recovery_threshold}
            batteryMaxSoc={config.battery_max_soc}
            batteryMinSoc={config.battery_min_soc}
            currentSoc={soc}
            isOutage={isOutage}
            isActive={isActive}
            tierStats={tierStats}
            onChange={({ critical, tier2, recovery }) => {
              setLocalConfig((prev) => ({
                ...prev,
                critical_soc: critical,
                tier2_threshold: tier2,
                recovery_threshold: recovery,
              }))
              setSaved(false)
            }}
            onLimitsChange={({ maxSoc, minSoc }) => {
              setLocalConfig((prev) => ({
                ...prev,
                battery_max_soc: maxSoc,
                battery_min_soc: minSoc,
              }))
              setSaved(false)
            }}
          />
        </div>
      </div>

      {/* Restore Settings */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Restore Settings
          </h3>
        </div>
        <div className="px-5 py-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-5 text-sm text-blue-800">
            <p className="mb-1 font-medium">Staged restore prevents inverter overload</p>
            <p className="text-xs text-blue-700">
              Devices are restored in order T3 &rarr; T2 &rarr; T1 with configurable delays
              between tiers and individual devices.
            </p>
          </div>

          {/* Tier delay cards */}
          <div className="space-y-3 mb-5">
            {RESTORE_TIERS.map((tier) => {
              const display = TIER_DISPLAY[tier.tierId as keyof typeof TIER_DISPLAY]
              const delays = restoreConfig.tier_delays[tier.key] || { tier_delay: 0, device_delay: 5 }
              const entityCount = entities.filter((e) => e.labels.includes(tier.tierId)).length
              const dotColor = tier.key === 'tier1' ? 'bg-red-500' : tier.key === 'tier2' ? 'bg-amber-500' : 'bg-green-500'

              return (
                <div key={tier.key} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                    <span className="text-xs font-semibold text-gray-700">{display.label.split(' — ')[0]}</span>
                    <span className="text-[10px] text-gray-400">({entityCount} device{entityCount !== 1 ? 's' : ''})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Wait before restore</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={300}
                          step={5}
                          value={delays.tier_delay}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 0
                            setLocalRestoreConfig((prev) => ({
                              ...prev,
                              tier_delays: { ...prev.tier_delays, [tier.key]: { ...delays, tier_delay: Math.max(0, v) } },
                            }))
                            setSaved(false)
                          }}
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <span className="text-[10px] text-gray-400">s</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Delay between devices</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step={1}
                          value={delays.device_delay}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 0
                            setLocalRestoreConfig((prev) => ({
                              ...prev,
                              tier_delays: { ...prev.tier_delays, [tier.key]: { ...delays, device_delay: Math.max(0, v) } },
                            }))
                            setSaved(false)
                          }}
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <span className="text-[10px] text-gray-400">s</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Per-device restore settings */}
          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-1">Per-Device Settings</h4>
            <p className="text-[10px] text-gray-500 mb-2">
              Override restore behavior for individual devices. &quot;Standard&quot; uses the tier default delay.
            </p>
            {(() => {
              const assigned = entities.filter((e) =>
                e.labels.some((l) => l === 'battery_guard_tier1' || l === 'battery_guard_tier2' || l === 'battery_guard_tier3'),
              )
              if (assigned.length === 0) {
                return <p className="text-xs text-gray-400 py-1">No assigned devices.</p>
              }
              return (
                <div className="space-y-1">
                  {assigned.map((entity) => {
                    const isStayOff = restoreConfig.stay_off.includes(entity.entity_id)
                    const customDelay = restoreConfig.device_delays?.[entity.entity_id]
                    const mode: 'standard' | 'custom_delay' | 'do_not_restore' =
                      isStayOff ? 'do_not_restore' : customDelay !== undefined ? 'custom_delay' : 'standard'

                    function handleModeChange(newMode: string) {
                      setLocalRestoreConfig((prev) => {
                        const newStayOff = prev.stay_off.filter((id) => id !== entity.entity_id)
                        const newDelays = { ...prev.device_delays }
                        delete newDelays[entity.entity_id]

                        if (newMode === 'do_not_restore') newStayOff.push(entity.entity_id)
                        if (newMode === 'custom_delay') newDelays[entity.entity_id] = 30

                        return { ...prev, stay_off: newStayOff, device_delays: newDelays }
                      })
                      setSaved(false)
                    }

                    return (
                      <div key={entity.entity_id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-50">
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded shrink-0">{entity.domain}</span>
                        <span className="text-xs text-gray-700 truncate min-w-0 flex-1">{entity.friendly_name}</span>
                        <select
                          value={mode}
                          onChange={(e) => handleModeChange(e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
                        >
                          <option value="standard">Standard</option>
                          <option value="custom_delay">Custom Delay</option>
                          <option value="do_not_restore">Do Not Restore</option>
                        </select>
                        {mode === 'custom_delay' && (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={1}
                              max={300}
                              step={5}
                              value={customDelay ?? 30}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10) || 1
                                setLocalRestoreConfig((prev) => ({
                                  ...prev,
                                  device_delays: { ...prev.device_delays, [entity.entity_id]: v },
                                }))
                                setSaved(false)
                              }}
                              className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] text-right bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <span className="text-[10px] text-gray-400">s</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Error / Success messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Outage settings and restore configuration saved. Integration reloaded.
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

/** Multi-range battery slider with colored zones and three drag handles */
function BatteryStageSlider({
  critical,
  tier2,
  recovery,
  batteryMaxSoc,
  batteryMinSoc,
  currentSoc,
  isOutage,
  isActive,
  tierStats,
  onChange,
  onLimitsChange,
}: {
  critical: number
  tier2: number
  recovery: number
  batteryMaxSoc: number
  batteryMinSoc: number
  currentSoc: number | null
  isOutage: boolean
  isActive: boolean
  tierStats: TierStats
  onChange: (values: { critical: number; tier2: number; recovery: number }) => void
  onLimitsChange: (values: { maxSoc: number; minSoc: number }) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const activeHandle = useRef<'critical' | 'tier2' | 'recovery' | null>(null)

  const snap = (value: number, step: number) => Math.round(value / step) * step

  const clampAndUpdate = (handle: 'critical' | 'tier2' | 'recovery', rawPct: number) => {
    let value: number
    switch (handle) {
      case 'critical':
        value = snap(Math.max(5, Math.min(rawPct, tier2 - 1)), 1)
        onChange({ critical: value, tier2, recovery })
        break
      case 'tier2':
        value = snap(Math.max(critical + 5, Math.min(rawPct, recovery - 5)), 5)
        onChange({ critical, tier2: value, recovery })
        break
      case 'recovery':
        value = snap(Math.max(tier2 + 5, Math.min(rawPct, 95)), 5)
        onChange({ critical, tier2, recovery: value })
        break
    }
  }

  const pctFromPointer = (clientX: number) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    // Inverted: 100% is on the left, 0% on the right
    return 100 - Math.round(((clientX - rect.left) / rect.width) * 100)
  }

  const handlePointerDown = (handle: 'critical' | 'tier2' | 'recovery') =>
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      activeHandle.current = handle
    }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle.current) return
    clampAndUpdate(activeHandle.current, pctFromPointer(e.clientX))
  }

  const handlePointerUp = () => {
    activeHandle.current = null
  }

  const handleNumberInput = (handle: 'critical' | 'tier2' | 'recovery', raw: string) => {
    const v = Number(raw)
    if (Number.isNaN(v)) return
    clampAndUpdate(handle, v)
  }

  // Zones ordered left-to-right: 100% (full) → 0% (empty)
  // Colors show escalating intervention severity, not device health
  const zones = [
    { width: 100 - recovery, color: 'bg-blue-200' },
    { width: recovery - tier2, color: 'bg-amber-200' },
    { width: tier2 - critical, color: 'bg-orange-400' },
    { width: critical, color: 'bg-red-400' },
  ]

  const handles: { key: 'critical' | 'tier2' | 'recovery'; pct: number; color: string }[] = [
    { key: 'critical', pct: critical, color: 'bg-red-500 ring-red-200' },
    { key: 'tier2', pct: tier2, color: 'bg-orange-500 ring-orange-200' },
    { key: 'recovery', pct: recovery, color: 'bg-green-500 ring-green-200' },
  ]

  return (
    <div className="select-none">
      {/* Grid status */}
      {isOutage || isActive ? (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-red-50 border border-red-200">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <div>
            <p className="text-sm font-medium text-red-700">
              {isActive ? 'Power Outage — System Active' : 'Power Outage Detected'}
            </p>
            <p className="text-xs text-red-500">
              {isActive
                ? 'Battery Guard is managing devices based on battery level.'
                : 'Activating — debounce in progress...'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-gray-50 border border-gray-200">
          <span className="inline-flex rounded-full h-2.5 w-2.5 bg-green-400 shrink-0" />
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-600">Grid Normal</span>
            {' — '}System inactive. Actions only trigger during a power outage.
          </p>
        </div>
      )}

      {/* Slider track */}
      <div className="px-3">
        <div
          ref={trackRef}
          className="relative h-6 cursor-pointer"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Colored zone segments */}
          <div className="absolute inset-0 rounded-full overflow-hidden flex">
            {zones.map((z, i) => (
              <div
                key={i}
                className={`${z.color} h-full transition-all duration-75`}
                style={{ width: `${z.width}%` }}
              />
            ))}
          </div>

          {/* Drag handles */}
          {handles.map(({ key, pct, color }) => (
            <div
              key={key}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full ${color} ring-2 shadow-md cursor-grab active:cursor-grabbing touch-none`}
              style={{ left: `${100 - pct}%` }}
              onPointerDown={handlePointerDown(key)}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-gray-600 whitespace-nowrap">
                {pct}%
              </div>
            </div>
          ))}

          {/* Battery system limit overlays (hatched zones) */}
          {batteryMaxSoc < 100 && (
            <div
              className="absolute top-0 left-0 h-full bg-gray-900/15 pointer-events-none"
              style={{ width: `${100 - batteryMaxSoc}%` }}
            >
              <div
                className="w-full h-full opacity-30"
                style={{
                  backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
                }}
              />
            </div>
          )}
          {batteryMinSoc > 0 && (
            <div
              className="absolute top-0 right-0 h-full bg-gray-900/15 pointer-events-none"
              style={{ width: `${batteryMinSoc}%` }}
            >
              <div
                className="w-full h-full opacity-30"
                style={{
                  backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
                }}
              />
            </div>
          )}
        </div>

        {/* Scale labels + SOC indicator below slider */}
        <div className="relative h-7 mt-1.5">
          {/* 100% label — left */}
          <div className="absolute left-0 top-0 flex items-center gap-1 text-[10px] text-gray-400">
            <BatteryIcon fill={1} className="w-3.5 h-3.5" />
            <span>100%</span>
          </div>

          {/* 0% label — right */}
          <div className="absolute right-0 top-0 flex items-center gap-1 text-[10px] text-gray-400">
            <span>0%</span>
            <BatteryIcon fill={0} className="w-3.5 h-3.5" />
          </div>

          {/* Current SOC indicator — colored by active tier */}
          {currentSoc !== null && (() => {
            const tierColor = currentSoc >= recovery
              ? 'text-blue-400'
              : currentSoc >= tier2
                ? 'text-amber-500'
                : currentSoc >= critical
                  ? 'text-orange-500'
                  : 'text-red-500'
            return (
              <div
                className={`absolute -translate-x-1/2 flex flex-col items-center ${tierColor}`}
                style={{ left: `${100 - currentSoc}%`, top: 0 }}
              >
                <svg className="w-2.5 h-2" viewBox="0 0 10 6" fill="currentColor">
                  <path d="M5 0L10 6H0z" />
                </svg>
                <span className="flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap">
                  <BatteryIcon fill={currentSoc / 100} className="w-3.5 h-3.5" />
                  {currentSoc}%
                </span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Legend — ordered left-to-right matching the slider */}
      <div className="mt-6 space-y-3">
        <ZoneLegendRow
          color="bg-blue-200"
          label="Tier 1"
          range={`100 – ${recovery}%`}
          description="Immediate on outage — low-priority devices managed"
          deviceSummary={formatTierSummary(tierStats.tier1)}
        />
        <ZoneLegendRow
          color="bg-amber-200"
          label="Recovery Buffer"
          range={`${recovery} – ${tier2}%`}
          description="Hysteresis zone — Tier 2 devices only restore above this level"
          inputValue={recovery}
          inputLabel="Recovery at"
          onInput={(v) => handleNumberInput('recovery', v)}
          step={5}
          min={tier2 + 5}
          max={95}
        />
        <ZoneLegendRow
          color="bg-orange-400"
          label="Tier 2"
          range={`${tier2} – ${critical}%`}
          description="SOC below threshold — mid-priority device actions execute"
          deviceSummary={formatTierSummary(tierStats.tier2)}
          inputValue={tier2}
          onInput={(v) => handleNumberInput('tier2', v)}
          step={5}
          min={critical + 5}
          max={recovery - 5}
        />
        <ZoneLegendRow
          color="bg-red-400"
          label="Critical"
          range={`${critical} – 0%`}
          description="Emergency — only Tier 3 (essential) devices remain active"
          deviceSummary={formatTierSummary(tierStats.tier3, true)}
          inputValue={critical}
          onInput={(v) => handleNumberInput('critical', v)}
          step={1}
          min={5}
          max={tier2 - 1}
        />
      </div>

      {/* Battery system limits */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Battery System Limits</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Max Charge</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={batteryMaxSoc}
                min={50}
                max={100}
                step={5}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isNaN(v)) onLimitsChange({ maxSoc: Math.max(50, Math.min(100, v)), minSoc: batteryMinSoc })
                }}
                className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Min Discharge</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={batteryMinSoc}
                min={0}
                max={50}
                step={5}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isNaN(v)) onLimitsChange({ maxSoc: batteryMaxSoc, minSoc: Math.max(0, Math.min(50, v)) })
                }}
                className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          Hatched areas on the slider mark ranges outside normal battery operation. During an outage, the inverter may discharge beyond the min limit.
        </p>
      </div>
    </div>
  )
}

/** Single row in the zone legend */
function ZoneLegendRow({
  color,
  label,
  range,
  description,
  deviceSummary,
  inputValue,
  inputLabel,
  onInput,
  step,
  min,
  max,
}: {
  color: string
  label: string
  range: string
  description: string
  deviceSummary?: string
  inputValue?: number
  inputLabel?: string
  onInput?: (value: string) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-3 h-3 rounded-sm ${color} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{label}</span>
            <span className="text-xs text-gray-400 ml-2">{range}</span>
          </div>
          {onInput && inputValue !== undefined && (
            <div className="flex items-center gap-1 shrink-0">
              {inputLabel && <span className="text-xs text-gray-400">{inputLabel}</span>}
              <input
                type="number"
                value={inputValue}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onInput(e.target.value)}
                className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        {deviceSummary && (
          <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M9.172 15.828a5 5 0 010-7.656m5.656 0a5 5 0 010 7.656M12 12h.008v.008H12V12z" />
            </svg>
            {deviceSummary}
          </p>
        )}
      </div>
    </div>
  )
}

/** Battery icon with dynamic fill level (0–1) */
function BatteryIcon({ fill, className }: { fill: number; className?: string }) {
  const fillHeight = Math.max(0, Math.min(1, fill)) * 11
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 4H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2zm0 14H5V6h12v12zm3-10v8h1a1 1 0 001-1V9a1 1 0 00-1-1h-1z" />
      {fillHeight > 0 && (
        <rect x="6" y={18 - fillHeight} width="10" height={fillHeight} rx="0.5" opacity="0.45" />
      )}
    </svg>
  )
}
