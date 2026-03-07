import { useState } from 'react'
import { useWizard } from '../hooks/useWizard'
import { connect } from '../services/ha-websocket'
import { WIZARD_STEPS } from '../types/wizard-types'

export function ConnectionStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [url, setUrl] = useState(
    config.haUrl || sessionStorage.getItem('bg_ha_url') || '',
  )
  const [token, setToken] = useState(
    config.accessToken || sessionStorage.getItem('bg_ha_token') || '',
  )
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>(
    config.connected ? 'idle' : 'idle',
  )
  const [error, setError] = useState('')

  async function handleConnect() {
    setStatus('connecting')
    setError('')

    try {
      const cleanUrl = url.replace(/\/+$/, '')
      await connect(cleanUrl, token)

      sessionStorage.setItem('bg_ha_url', cleanUrl)
      sessionStorage.setItem('bg_ha_token', token)

      dispatch({ type: 'SET_CONNECTION', haUrl: cleanUrl, accessToken: token })
      dispatch({ type: 'SET_CONNECTED', connected: true })
      setCurrentStep(WIZARD_STEPS[1])
    } catch (err) {
      setStatus('error')
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to connect. Check URL and token.',
      )
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Connect to Home Assistant
      </h2>
      <p className="text-gray-500 mb-6">
        Enter your Home Assistant URL and a Long-Lived Access Token to get
        started.
      </p>

      <div className="bg-white shadow-sm border border-gray-100 rounded-xl p-6 space-y-4">
        <div>
          <label
            htmlFor="ha-url"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Home Assistant URL
          </label>
          <input
            id="ha-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://homeassistant.local:8123"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          />
        </div>

        <div>
          <label
            htmlFor="ha-token"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Long-Lived Access Token
          </label>
          <input
            id="ha-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm transition-colors"
          />
          <p className="mt-1 text-xs text-gray-400">
            Create one at: Your Profile &rarr; Long-Lived Access Tokens &rarr; Create
            Token
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={!url || !token || status === 'connecting'}
          className="w-full py-2.5 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {status === 'connecting' ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
