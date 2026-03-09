import { useEffect, useRef, useState } from 'react'
import { useWizard } from '../../hooks/useWizard'
import { getVersion } from '../../services/ha-websocket'
import type { WizardStep } from '../../types/wizard-types'
import { WIZARD_STEPS, STEP_LABELS } from '../../types/wizard-types'

interface ReleaseNote {
  tag_name: string
  name: string
  body: string
  published_at: string
}

/** Navigation tabs shown when deployed */
const NAV_TABS: { step: WizardStep; label: string }[] = [
  { step: 'dashboard', label: 'Appliances' },
  { step: 'settings', label: 'System' },
  { step: 'restore', label: 'Restore' },
]

/** Steps that are part of the deployed navigation (not wizard flow) */
const DEPLOYED_STEPS: WizardStep[] = ['dashboard', 'settings', 'restore']

/** Modal showing release notes fetched from GitHub */
function ReleaseNotesModal({
  version,
  onClose,
}: {
  version: string
  onClose: () => void
}) {
  const [notes, setNotes] = useState<ReleaseNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch(
          'https://api.github.com/repos/florianschupp/ha-battery-guard/releases?per_page=10',
        )
        if (!res.ok) throw new Error(`GitHub API: ${res.status}`)
        const data: ReleaseNote[] = await res.json()
        setNotes(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load release notes')
      } finally {
        setLoading(false)
      }
    }
    fetchNotes()
  }, [version])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Release Notes</h2>
            <p className="text-sm text-gray-500">Battery Guard v{version}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="overflow-y-auto px-6 py-4 flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          )}

          {!loading && !error && notes.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No releases found.</p>
          )}

          {!loading &&
            !error &&
            notes.map((release, idx) => {
              const isCurrent = release.tag_name === `v${version}`
              return (
                <div
                  key={release.tag_name}
                  className={`${idx > 0 ? 'mt-6 pt-6 border-t border-gray-100' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-900">{release.tag_name}</span>
                    {isCurrent && (
                      <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        current
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(release.published_at).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
                    {formatReleaseBody(release.body)}
                  </div>
                </div>
              )
            })}
        </div>

        {/* Modal footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <a
            href="https://github.com/florianschupp/ha-battery-guard/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            All releases on GitHub &rarr;
          </a>
        </div>
      </div>
    </div>
  )
}

/** Simple markdown-lite formatter for release note bodies */
function formatReleaseBody(body: string): string {
  if (!body) return 'No release notes.'
  // Strip markdown links, keep text
  return body
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,3}\s*/g, '')
    .trim()
}

export function WizardShell({ children }: { children: React.ReactNode }) {
  const { currentStep, config, setCurrentStep } = useWizard()
  const currentIndex = WIZARD_STEPS.indexOf(currentStep)
  const isDeployedNav = config.deployed && DEPLOYED_STEPS.includes(currentStep)
  const isWizardFlow = !config.deployed || !DEPLOYED_STEPS.includes(currentStep)

  const [version, setVersion] = useState<string | null>(null)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const versionLoaded = useRef(false)

  useEffect(() => {
    if (versionLoaded.current) return
    versionLoaded.current = true
    let cancelled = false
    getVersion()
      .then((v) => { if (!cancelled) setVersion(v) })
      .catch(() => { /* Version endpoint not available (pre-v2.7 backend) */ })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Battery Guard
          </h1>
          {!isDeployedNav && (
            <span className="text-sm text-gray-400">Setup Wizard</span>
          )}
          {/* Back to overview when in wizard flow but already deployed */}
          {isWizardFlow && config.deployed && (
            <button
              onClick={() => setCurrentStep('dashboard')}
              className="ml-auto flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Overview
            </button>
          )}
        </div>
      </header>

      {/* Tab navigation — shown when deployed */}
      {isDeployedNav && (
        <nav className="bg-white border-b border-gray-200 px-6">
          <div className="max-w-5xl mx-auto flex gap-0">
            {NAV_TABS.map((tab) => {
              const isActive = currentStep === tab.step
              return (
                <button
                  key={tab.step}
                  onClick={() => setCurrentStep(tab.step)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </nav>
      )}

      {/* Stepper — shown during wizard flow only */}
      {isWizardFlow && !config.deployed && (
        <nav className="bg-white border-b border-gray-100 px-6 py-3">
          <div className="max-w-5xl mx-auto">
            <ol className="flex items-center justify-between sm:justify-start sm:gap-2">
              {WIZARD_STEPS.map((step, index) => {
                const isActive = index === currentIndex
                const isCompleted = index < currentIndex

                return (
                  <li key={step} className="flex items-center gap-1 sm:gap-2">
                    {index > 0 && (
                      <div
                        className={`w-4 sm:w-8 h-px ${isCompleted ? 'bg-blue-500' : 'bg-gray-200'}`}
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                          isActive
                            ? 'bg-blue-500 text-white'
                            : isCompleted
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {isCompleted ? (
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2.5}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          index + 1
                        )}
                      </div>
                      <span
                        className={`text-sm hidden sm:inline ${
                          isActive
                            ? 'font-medium text-gray-900'
                            : isCompleted
                              ? 'text-gray-700'
                              : 'text-gray-400'
                        }`}
                      >
                        {STEP_LABELS[step]}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </nav>
      )}

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex-1 w-full">{children}</main>

      {/* Footer */}
      <footer className="px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-center">
          {version && (
            <button
              onClick={() => setShowReleaseNotes(true)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              title="Show release notes"
            >
              Battery Guard v{version}
            </button>
          )}
        </div>
      </footer>

      {/* Release Notes Modal */}
      {showReleaseNotes && version && (
        <ReleaseNotesModal
          version={version}
          onClose={() => setShowReleaseNotes(false)}
        />
      )}
    </div>
  )
}
