// Client list: add, edit, and delete. Editing matters because a client's rate
// and retainer change over time, and the only alternative — delete and recreate
// — cascades away every session and report already recorded against them.

import { useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import type { Client } from '@shared/types'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#64748b']

interface Draft {
  name: string
  retainer: string
  color: string
}

function draftFrom(c: Client): Draft {
  return {
    name: c.name,
    retainer: c.retainerHours ? String(c.retainerHours) : '',
    color: c.color
  }
}

function ColorPicker({
  value,
  onChange
}: {
  value: string
  onChange: (c: string) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-1">
      {COLORS.map((c) => (
        <button
          type="button"
          key={c}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 ${
            value === c ? 'border-slate-900' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

export function Clients(): React.JSX.Element {
  const clients = useStore((s) => s.clients)
  const refreshClients = useStore((s) => s.refreshClients)
  const [name, setName] = useState('')
  const [retainer, setRetainer] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function addClient(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return
    await api.createClient({
      name: name.trim(),
      retainerHours: Number(retainer) || 0,
      color
    })
    setName('')
    setRetainer('')
    await refreshClients()
  }

  function startEdit(c: Client): void {
    setNotice(null)
    setEditingId(c.id)
    setDraft(draftFrom(c))
  }

  function cancelEdit(): void {
    setEditingId(null)
    setDraft(null)
  }

  async function saveEdit(id: number): Promise<void> {
    if (!draft || !draft.name.trim()) return
    const result = await api.updateClient(id, {
      name: draft.name.trim(),
      retainerHours: Number(draft.retainer) || 0,
      color: draft.color
    })

    // A rename has to reach the shared database too, since the team's history is
    // joined by name. Say so plainly when it couldn't be carried across.
    if (result.remoteRename === 'name-taken') {
      setNotice(
        `Renamed locally, but the team database already has a client called "${draft.name.trim()}". Its team history is still under the old name.`
      )
    } else if (result.remoteRename === 'failed') {
      setNotice(
        'Renamed locally, but the team database could not be reached — its team history is still under the old name.'
      )
    } else {
      setNotice(null)
    }

    cancelEdit()
    await refreshClients()
  }

  async function remove(id: number): Promise<void> {
    const client = clients.find((c) => c.id === id)
    const ok = window.confirm(
      `Delete "${client?.name ?? 'this client'}"? Every session and report recorded against it on this machine goes too. To change its retainer, use Edit instead.`
    )
    if (!ok) return
    await api.deleteClient(id)
    await refreshClients()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Clients</h1>

      <form
        onSubmit={addClient}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5"
            placeholder="Acme Corp"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">Retainer hrs / mo</span>
          <input
            value={retainer}
            onChange={(e) => setRetainer(e.target.value)}
            type="number"
            step="0.5"
            className="w-32 rounded-md border border-slate-300 px-3 py-1.5"
            placeholder="40"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">Colour</span>
          <ColorPicker value={color} onChange={setColor} />
        </label>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add client
        </button>
      </form>

      {notice && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {notice}
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        {clients.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">No clients yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {clients.map((c) =>
                editingId === c.id && draft ? (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td colSpan={3} className="px-4 py-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex flex-col text-sm">
                          <span className="mb-1 text-slate-500">Name</span>
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className="rounded-md border border-slate-300 px-3 py-1.5"
                          />
                        </label>
                        <label className="flex flex-col text-sm">
                          <span className="mb-1 text-slate-500">Retainer hrs / mo</span>
                          <input
                            value={draft.retainer}
                            onChange={(e) => setDraft({ ...draft, retainer: e.target.value })}
                            type="number"
                            step="0.5"
                            className="w-32 rounded-md border border-slate-300 px-3 py-1.5"
                          />
                        </label>
                        <label className="flex flex-col text-sm">
                          <span className="mb-1 text-slate-500">Colour</span>
                          <ColorPicker
                            value={draft.color}
                            onChange={(col) => setDraft({ ...draft, color: col })}
                          />
                        </label>
                        <button
                          onClick={() => saveEdit(c.id)}
                          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {c.retainerHours > 0 ? `${c.retainerHours} h/mo retainer` : 'No retainer'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => startEdit(c)}
                        className="mr-3 text-sm text-slate-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
