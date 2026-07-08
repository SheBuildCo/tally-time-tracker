// Read-only consumer of the local ActivityWatch REST API (default
// http://localhost:5600). Tally never writes to AW — it only reads window,
// afk, and browser-extension buckets to reconstruct what the user was doing.

import type { UsageEvent } from '../shared/types'

const AW_BASE = process.env.AW_BASE_URL || 'http://localhost:5600'

// Raw event shape returned by AW's query engine.
interface AwEvent {
  timestamp: string
  duration: number // seconds
  data: Record<string, unknown>
}

interface AwBucket {
  id: string
  type: string
  client: string
  hostname: string
}

// Known browser executables → used to detect which window slices are browsers
// so we can overlay the per-tab web-extension events onto them.
const BROWSER_APPS = new Set([
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'vivaldi.exe',
  'comet.exe',
  'arc.exe'
])

export async function isAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${AW_BASE}/api/0/info`, {
      signal: AbortSignal.timeout(2000)
    })
    return res.ok
  } catch {
    return false
  }
}

async function getBuckets(): Promise<Record<string, AwBucket>> {
  const res = await fetch(`${AW_BASE}/api/0/buckets/`)
  if (!res.ok) throw new Error(`AW buckets request failed: ${res.status}`)
  return (await res.json()) as Record<string, AwBucket>
}

async function runQuery(timeperiod: string, query: string[]): Promise<AwEvent[]> {
  const res = await fetch(`${AW_BASE}/api/0/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeperiods: [timeperiod], query })
  })
  if (!res.ok) throw new Error(`AW query failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as AwEvent[][]
  return data[0] ?? []
}

// Fetch active-usage events for [startISO, endISO). Returns stitched UsageEvents
// where browser slices carry the real tab title + URL rather than a coarse
// "chrome.exe" entry. Returns [] if AW is unreachable.
export async function fetchEvents(startISO: string, endISO: string): Promise<UsageEvent[]> {
  if (!(await isAvailable())) return []

  const buckets = await getBuckets()
  const bucketIds = Object.keys(buckets)
  const windowBucket = bucketIds.find((id) => id.startsWith('aw-watcher-window_'))
  const afkBucket = bucketIds.find((id) => id.startsWith('aw-watcher-afk_'))
  const webBuckets = bucketIds.filter((id) => id.startsWith('aw-watcher-web'))

  if (!windowBucket) return []

  const timeperiod = `${startISO}/${endISO}`

  // Active window events = window events intersected with non-afk periods.
  const activeWindowQuery = afkBucket
    ? [
        `window = flood(query_bucket("${windowBucket}"));`,
        `afk = flood(query_bucket("${afkBucket}"));`,
        `not_afk = filter_keyvals(afk, "status", ["not-afk"]);`,
        `active = filter_period_intersect(window, not_afk);`,
        `RETURN = active;`
      ]
    : [`RETURN = flood(query_bucket("${windowBucket}"));`]

  const windowEvents = await runQuery(timeperiod, activeWindowQuery)

  // Per-browser tab events, limited to when that browser was the focused window
  // and the user was not afk.
  const browserEvents: AwEvent[] = []
  for (const webBucket of webBuckets) {
    const browserApp = detectBrowserApp(buckets[webBucket]?.client)
    const filterApps = browserApp ? [browserApp] : Array.from(BROWSER_APPS)
    const q = [
      `web = flood(query_bucket("${webBucket}"));`,
      `window = flood(query_bucket("${windowBucket}"));`,
      `browser_window = filter_keyvals(window, "app", ${JSON.stringify(filterApps)});`,
      `web = filter_period_intersect(web, browser_window);`,
      ...(afkBucket
        ? [
            `afk = flood(query_bucket("${afkBucket}"));`,
            `not_afk = filter_keyvals(afk, "status", ["not-afk"]);`,
            `web = filter_period_intersect(web, not_afk);`
          ]
        : []),
      `RETURN = web;`
    ]
    try {
      const evts = await runQuery(timeperiod, q)
      browserEvents.push(...evts)
    } catch {
      // A malformed/empty web bucket shouldn't kill the whole ingest.
    }
  }

  return stitchUsage(windowEvents, browserEvents)
}

function detectBrowserApp(client: string | undefined): string | null {
  if (!client) return null
  const c = client.toLowerCase()
  if (c.includes('chrome')) return 'chrome.exe'
  if (c.includes('edge')) return 'msedge.exe'
  if (c.includes('firefox')) return 'firefox.exe'
  if (c.includes('brave')) return 'brave.exe'
  return null
}

// Merge browser-extension tab events onto the coarse window slices. For any
// window slice whose app is a browser, we drop the window-level entry and emit
// the overlapping tab events instead (each with its own title/URL). Non-browser
// window slices pass through unchanged.
export function stitchUsage(windowEvents: AwEvent[], browserEvents: AwEvent[]): UsageEvent[] {
  const out: UsageEvent[] = []

  for (const w of windowEvents) {
    const app = String(w.data.app ?? '').trim()
    const title = String(w.data.title ?? '').trim()

    if (BROWSER_APPS.has(app.toLowerCase())) {
      const wStart = Date.parse(w.timestamp)
      const wEnd = wStart + w.duration * 1000
      const overlaps = browserEvents.filter((b) => {
        const bStart = Date.parse(b.timestamp)
        const bEnd = bStart + b.duration * 1000
        return bStart < wEnd && bEnd > wStart
      })

      if (overlaps.length === 0) {
        // Browser was focused but we have no tab data — keep the window slice.
        out.push({ timestamp: w.timestamp, duration: w.duration, app, title, host: '' })
        continue
      }

      for (const b of overlaps) {
        const bStart = Date.parse(b.timestamp)
        const bEnd = bStart + b.duration * 1000
        const clippedStart = Math.max(wStart, bStart)
        const clippedEnd = Math.min(wEnd, bEnd)
        const seconds = Math.max(0, (clippedEnd - clippedStart) / 1000)
        if (seconds <= 0) continue
        const url = String(b.data.url ?? '')
        out.push({
          timestamp: new Date(clippedStart).toISOString(),
          duration: seconds,
          app,
          title: String(b.data.title ?? title),
          host: hostFromUrl(url),
          url
        })
      }
    } else {
      out.push({ timestamp: w.timestamp, duration: w.duration, app, title, host: '' })
    }
  }

  return out
}

function hostFromUrl(url: string): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
