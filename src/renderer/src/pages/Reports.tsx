import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { ReportHistoryEntry } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'
import { formatDate } from '../format'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function Reports(): React.JSX.Element {
  const clients = useStore((s) => s.clients)
  const [clientId, setClientId] = useState<number | ''>('')
  const [startDay, setStartDay] = useState(daysAgo(7))
  const [endDay, setEndDay] = useState(daysAgo(0))
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<ReportHistoryEntry[]>([])

  const loadHistory = useCallback(async () => {
    setHistory(await api.listReportHistory())
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (clientId === '' && clients.length > 0) setClientId(clients[0].id)
  }, [clients, clientId])

  async function generate(): Promise<void> {
    if (clientId === '') return
    setGenerating(true)
    setError(null)
    try {
      await api.generateReport(clientId, startDay, endDay)
      await loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  const clientName = (id: number): string => clients.find((c) => c.id === id)?.name ?? `Client #${id}`

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reports</h1>
        <Link to="/reports/template" className="text-sm text-slate-500 hover:text-slate-900">
          Edit template →
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">Client</span>
          <select
            value={clientId}
            onChange={(e) => setClientId(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-3 py-1.5"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">From</span>
          <input
            type="date"
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-500">To</span>
          <input
            type="date"
            value={endDay}
            onChange={(e) => setEndDay(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5"
          />
        </label>
        <button
          onClick={generate}
          disabled={generating || clientId === ''}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate report'}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 font-medium">History</h2>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">No reports generated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Range</th>
                <th className="px-4 py-2 font-medium">Generated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-50">
                  <td className="px-4 py-2">{clientName(h.clientId)}</td>
                  <td className="px-4 py-2">
                    {h.startDate} – {h.endDate}
                  </td>
                  <td className="px-4 py-2">{formatDate(h.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => api.openReportFile(h.pdfPath)}
                      className="mr-3 text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      Open PDF
                    </button>
                    <button
                      onClick={() => api.openReportFile(h.csvPath)}
                      className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      Open CSV
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
