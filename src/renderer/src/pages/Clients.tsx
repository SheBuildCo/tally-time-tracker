import { useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#64748b']

export function Clients(): React.JSX.Element {
  const clients = useStore((s) => s.clients)
  const refreshClients = useStore((s) => s.refreshClients)
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [color, setColor] = useState(COLORS[0])

  async function addClient(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return
    await api.createClient({ name: name.trim(), billableRate: Number(rate) || 0, color })
    setName('')
    setRate('')
    await refreshClients()
  }

  async function remove(id: number): Promise<void> {
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
          <span className="mb-1 text-slate-500">Rate / hr</span>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            type="number"
            className="w-28 rounded-md border border-slate-300 px-3 py-1.5"
            placeholder="150"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">Colour</span>
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${
                  color === c ? 'border-slate-900' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </label>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add client
        </button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white">
        {clients.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">No clients yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {clients.map((c) => (
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
                    {c.billableRate > 0 ? `$${c.billableRate}/hr` : 'Non-billable'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => remove(c.id)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
