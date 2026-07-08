// Rule engine: maps raw UsageEvents onto clients using the user's MappingRules.
// Rules are evaluated by ascending priority; first match wins. An event that
// matches no rule is "unassigned" (clientId null, not billable).

import type { UsageEvent, MappingRule, Categorized } from '../shared/types'

// Stable, human-ish label used both for rollup grouping and for matching
// session exclusions. Prefer the window/tab title, fall back to the app name.
export function activityLabel(event: UsageEvent): string {
  const t = event.title.trim()
  return t || event.app
}

function domainMatches(host: string, ruleDomain: string): boolean {
  if (!host) return false
  const h = host.toLowerCase()
  const d = ruleDomain.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

function ruleMatches(event: UsageEvent, rule: MappingRule): boolean {
  const { app, titleRegex, urlDomain } = rule.match
  // A rule with no criteria never matches (guards against catch-all seeds).
  if (!app && !titleRegex && !urlDomain) return false

  if (app && event.app.toLowerCase() !== app.toLowerCase()) return false
  if (urlDomain && !domainMatches(event.host, urlDomain)) return false
  if (titleRegex) {
    try {
      if (!new RegExp(titleRegex, 'i').test(event.title)) return false
    } catch {
      return false // invalid regex never matches
    }
  }
  return true
}

export function categorizeEvent(event: UsageEvent, rules: MappingRule[]): Categorized {
  // rules assumed pre-sorted by priority; sort defensively anyway.
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (ruleMatches(event, rule)) {
      return {
        event,
        clientId: rule.clientId,
        billable: rule.billable,
        matchedRuleId: rule.id
      }
    }
  }
  return { event, clientId: null, billable: false, matchedRuleId: null }
}

export function categorizeAll(events: UsageEvent[], rules: MappingRule[]): Categorized[] {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)
  return events.map((e) => categorizeEvent(e, sorted))
}
