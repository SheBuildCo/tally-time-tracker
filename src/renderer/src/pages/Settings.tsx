import { useEffect, useState } from 'react'
import type { Settings as SettingsModel, TeamStatus } from '@shared/types'
import { api } from '../api'
import { formatDate } from '../format'

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

// Team sync setup: who this machine reports as, and where the shared database
// lives. The connection string is a shared secret — it's stored locally (not in
// the build) so it can be rotated without shipping a new installer.
function TeamSyncSection(): React.JSX.Element {
  const [status, setStatus] = useState<TeamStatus | null>(null)
  const [person, setPerson] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'test' | 'save' | 'sync' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    api.teamStatus().then((s) => {
      setStatus(s)
      setPerson(s.personName ?? '')
    })
  }, [])

  async function test(): Promise<void> {
    setBusy('test')
    setResult(null)
    try {
      // Test what's typed if the field has a value; otherwise the stored one.
      setResult(await api.teamTest(url.trim() || undefined))
    } finally {
      setBusy(null)
    }
  }

  async function save(): Promise<void> {
    setBusy('save')
    setResult(null)
    try {
      if (!person.trim()) {
        setResult({ ok: false, message: 'Your name is required — it identifies your time.' })
        return
      }
      const check = await api.teamTest(url.trim() || undefined)
      if (!check.ok) {
        setResult(check) // don't save a connection string that doesn't work
        return
      }
      await api.teamSetup(person.trim(), url.trim() || '')
      setStatus(await api.teamStatus())
      setUrl('') // don't keep the secret in component state once stored
      setResult({ ok: true, message: 'Saved. Your time will sync every few minutes.' })
    } finally {
      setBusy(null)
    }
  }

  async function syncNow(): Promise<void> {
    setBusy('sync')
    setResult(null)
    try {
      const r = await api.teamSync()
      setResult(r)
      setStatus(await api.teamStatus())
    } finally {
      setBusy(null)
    }
  }

  const configured = status?.configured ?? false

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">Team sync</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {configured ? 'Connected' : 'Not set up'}
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Pushes your tracked time to the shared team database so everyone’s hours appear in one
        place. Tally keeps recording locally either way — if this is off or offline, nothing is
        lost, it just catches up later.
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Your name</label>
          <input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="e.g. Oli"
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            How your time is labelled for the team. Use the same name every time.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Database connection string {status?.hasUrl && !url && (
              <span className="font-normal text-slate-500">— saved, leave blank to keep</span>
            )}
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="password"
            placeholder={status?.hasUrl ? '••••••••••••••••' : 'postgresql://postgres:…@db.….supabase.co:5432/postgres'}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-slate-500">
            Treat this like a shared password — anyone with it can read and change the team’s data.
          </p>
        </div>

        {result && (
          <p
            className={`rounded-md px-3 py-2 text-xs ${
              result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
            }`}
          >
            {result.message}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={test}
            disabled={busy !== null}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          {configured && (
            <button
              onClick={syncNow}
              disabled={busy !== null}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>

        {status?.lastSync && (
          <p className="text-xs text-slate-500">
            Last sync: {status.lastSync.ok ? '' : 'failed — '}
            {status.lastSync.message} ({formatDate(status.lastSync.at)})
          </p>
        )}
      </div>
    </section>
  )
}

export function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsModel | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [idleMinutes, setIdleMinutes] = useState('')

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      setIdleMinutes(String(s.idleAutoStopMinutes))
    })
  }, [])

  async function saveIdle(): Promise<void> {
    const m = Math.round(Number(idleMinutes))
    if (!Number.isFinite(m) || m <= 0) {
      // Ignore an invalid entry and revert the field to the saved value.
      if (settings) setIdleMinutes(String(settings.idleAutoStopMinutes))
      return
    }
    await api.setIdleAutoStop(m)
    setSettings((s) => (s ? { ...s, idleAutoStopMinutes: m } : s))
    setIdleMinutes(String(m))
  }

  async function clearActivityData(): Promise<void> {
    setClearing(true)
    try {
      await api.clearActivityData()
      const fresh = await api.getSettings()
      setSettings(fresh)
    } finally {
      setClearing(false)
      setConfirmingClear(false)
    }
  }

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

      <TeamSyncSection />

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
        {settings.awStatus && !settings.awAfkWatcher && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Idle detection unavailable — the ActivityWatch <strong>AFK watcher</strong> isn’t
            running. Without it, time away from your computer is counted as active and session
            durations can be inflated. Start ActivityWatch fully (it includes the AFK watcher) to
            fix this.
          </p>
        )}
        <div className="mt-2 text-xs text-slate-500">
          Tracking activity since {formatDate(settings.trackingStartedAt)}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Timer</h2>
        <label className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Auto-stop when idle</div>
            <div className="text-xs text-slate-500">
              Stops a running timer after this many minutes with no activity, so a forgotten
              timer doesn’t keep counting. The idle time itself is never billed.
            </div>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <input
              type="number"
              min={1}
              value={idleMinutes}
              onChange={(e) => setIdleMinutes(e.target.value)}
              onBlur={saveIdle}
              className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-right"
            />
            <span className="text-slate-500">min</span>
          </div>
        </label>
      </section>

      <section className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="mb-1 font-medium text-red-900">Danger zone</h2>
        <p className="mb-3 text-sm text-red-700">
          Clears all tracked hours and re-anchors tracking to right now, so
          ActivityWatch history from before this moment is never pulled in again.
          Your clients, rules, and recorded sessions are not affected.
        </p>
        {confirmingClear ? (
          <div className="flex items-center gap-2">
            <button
              onClick={clearActivityData}
              disabled={clearing}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {clearing ? 'Clearing…' : 'Yes, clear all activity data'}
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              disabled={clearing}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingClear(true)}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Clear activity data
          </button>
        )}
      </section>
    </div>
  )
}
