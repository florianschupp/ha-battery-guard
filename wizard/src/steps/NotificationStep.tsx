import { useEffect, useState } from 'react'
import { useWizard } from '../context/WizardContext'
import { getNotifyServices } from '../services/ha-websocket'
import { WIZARD_STEPS } from '../types/wizard-types'
import type { HANotifyService } from '../types/ha-types'

export function NotificationStep() {
  const { config, dispatch, setCurrentStep } = useWizard()
  const [services, setServices] = useState<HANotifyService[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadServices()
  }, [])

  async function loadServices() {
    setLoading(true)
    try {
      const notifyServices = await getNotifyServices()
      setServices(notifyServices)
    } finally {
      setLoading(false)
    }
  }

  function toggleService(service: string) {
    const current = config.notifyServices
    const updated = current.includes(service)
      ? current.filter((s) => s !== service)
      : [...current, service]
    dispatch({ type: 'SET_NOTIFY_SERVICES', services: updated })
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Loading notification services...
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Notification Setup
      </h2>
      <p className="text-gray-600 mb-6">
        Select which notification services should receive Battery Guard alerts.
      </p>

      <div className="space-y-2 mb-6">
        {services.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">
            No notification services found. You can configure them later in the
            YAML files.
          </p>
        )}
        {services.map((service) => {
          const serviceId = `notify.${service.service}`
          const isSelected = config.notifyServices.includes(serviceId)

          return (
            <label
              key={serviceId}
              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                isSelected
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleService(serviceId)}
                className="w-4 h-4 accent-amber-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {service.name}
                </p>
                <p className="text-xs text-gray-500">{serviceId}</p>
              </div>
            </label>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 mb-6">
        HA persistent notifications are always enabled in addition to your
        selection.
      </p>

      <div className="flex gap-3">
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[4])}
          className="py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => setCurrentStep(WIZARD_STEPS[6])}
          className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
