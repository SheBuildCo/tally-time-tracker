import { useEffect, useState } from 'react'
import type { Settings as SettingsModel } from '@shared/types'
import { api } from '../api'

// Convert a keydown event into an Electron accelerator string.
function toAccelerator(e: React.KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  // Ignore pure modifier presses — wait for a real key.
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null

  let keyName = key.length === 1 ? key.toUpperCase() : key
  if (keyName === ' ') keyName = 'Space'
  parts.push(keyName)

  // Require at least one modifier so global shortcuts don't hijack typing.
  if (parts.length < 2) return null
  return parts.join('+')
}

function ShortcutInput({
  value,
  onChange
}: {
  value: string
  onChange: (accel: string) => void
}): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)

  return (
    <button
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={(e) => {
        if (!capturing) return
        e.preventDefault()
        const accel = toAccelerator(e)
        if (accel) {
          onChange(accel)
          setCapturing(false)
        }
      }}
      className={`min-w-48 rounded-md border px-3 py-1.5 text-left font-mono text-sm ${
        capturing ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white'
      }`}
    >
      {capturing ? 'Press keys…' : value}
    </button>
  )
}

export function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsModel | null>(null)

  useEffect(() => {
    api.getSettings().then(setSettings)
  }, [])

  async function saveShortcuts(toggle: string, picker: string): Promise<void> {
    await api.updateShortcuts(toggle, picker)
    setSettings((s) => (s ? { ...s, shortcutToggle: toggle, shortcutPicker: picker } : s))
  }

  async function toggleAutoLaunch(enabled: boolean): Promise<void> {
    await api.setAutoLaunch(enabled)
    setSettings((s) => (s ? { ...s, autoLaunch: enabled } : s))
  }

  if (!settings) return <p className="text-slate-500">Loading…</p>

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Keyboard shortcuts</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Start / stop timer</div>
              <div className="text-xs text-slate-500">
                Starts the picker when idle, stops when running
              </div>
            </div>
            <ShortcutInput
              value={settings.shortcutToggle}
              onChange={(a) => saveShortcuts(a, settings.shortcutPicker)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Open client picker</div>
              <div className="text-xs text-slate-500">Always shows the picker</div>
            </div>
            <ShortcutInput
              value={settings.shortcutPicker}
              onChange={(a) => saveShortcuts(settings.shortcutToggle, a)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Startup</h2>
        <label className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Launch at login</div>
            <div className="text-xs text-slate-500">
              Start Tally in the background when you sign in
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoLaunch}
            onChange={(e) => toggleAutoLaunch(e.target.checked)}
            className="h-5 w-5"
          />
        </label>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-medium">ActivityWatch</h2>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              settings.awStatus ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          {settings.awStatus ? (
            <span className="text-slate-700">Connected — capturing activity</span>
          ) : (
            <span className="text-slate-700">
              Not detected. Tally needs the ActivityWatch desktop app running.
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
