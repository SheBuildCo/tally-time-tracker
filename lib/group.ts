// Site-first grouping: collapse fine-grained activities (specific tabs/chats)
// into the site (host) they happened on, so the UI can lead with the site and
// expand to reveal the specific items. Pure — trivially unit-testable.

import type { ActivitySummary } from "./analytics";

export interface SiteGroup {
  site: string; // host when known, else the app name — the coarse "where"
  hours: number;
  billableHours: number;
  topClient: string; // dominant client name across the group's items (by hours)
  topClientId: number | null; // dominant client id (null = unassigned)
  items: ActivitySummary[]; // the specific activities, hours-desc
}

/**
 * Group activities by `host || app` into expandable site groups. Hours and
 * billable hours are summed; `topClient` is the client with the most hours in
 * the group (so a site mostly used for one client reads as that client).
 * Groups and their items are sorted by hours descending.
 */
export function groupActivitiesBySite(
  activities: ActivitySummary[],
): SiteGroup[] {
  const groups = new Map<
    string,
    {
      site: string;
      hours: number;
      billableHours: number;
      items: ActivitySummary[];
      // dominant-client tally, keyed by client id (null = unassigned)
      byClient: Map<number | null, { name: string; hours: number }>;
    }
  >();

  for (const a of activities) {
    const site = a.host || a.app;
    let g = groups.get(site);
    if (!g) {
      g = { site, hours: 0, billableHours: 0, items: [], byClient: new Map() };
      groups.set(site, g);
    }
    g.hours += a.hours;
    g.billableHours += a.billableHours;
    g.items.push(a);
    const entry = g.byClient.get(a.topClientId) ?? {
      name: a.topClient,
      hours: 0,
    };
    entry.hours += a.hours;
    g.byClient.set(a.topClientId, entry);
  }

  return [...groups.values()]
    .map((g) => {
      const dominant = dominantClient(g.byClient);
      return {
        site: g.site,
        hours: g.hours,
        billableHours: g.billableHours,
        topClient: dominant.name,
        topClientId: dominant.id,
        items: g.items.sort((x, y) => y.hours - x.hours),
      };
    })
    .sort((x, y) => y.hours - x.hours);
}

function dominantClient(
  byClient: Map<number | null, { name: string; hours: number }>,
): { id: number | null; name: string } {
  let bestId: number | null = null;
  let bestName = "";
  let bestHours = -1;
  for (const [id, { name, hours }] of byClient) {
    if (hours > bestHours) {
      bestId = id;
      bestName = name;
      bestHours = hours;
    }
  }
  return { id: bestId, name: bestName };
}

export interface AppGroup {
  app: string;
  hours: number;
  billableHours: number;
  topClient: string; // dominant client name across the app's activities (by hours)
  topClientId: number | null;
  sites: SiteGroup[]; // this app's activities, further grouped by site
}

/**
 * Group activities by app, each app's activities further grouped into sites via
 * `groupActivitiesBySite`. Used to lead a client's breakdown with the app (e.g.
 * distinguishing browser time from Teams/Outlook) when activity spans more than
 * one app — callers should skip this tier and render `groupActivitiesBySite`
 * directly when the result has only one group (the common single-app client).
 */
export function groupActivitiesByApp(activities: ActivitySummary[]): AppGroup[] {
  const byApp = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const list = byApp.get(a.app) ?? [];
    list.push(a);
    byApp.set(a.app, list);
  }

  return [...byApp.entries()]
    .map(([app, items]) => {
      const byClient = new Map<number | null, { name: string; hours: number }>();
      let hours = 0;
      let billableHours = 0;
      for (const a of items) {
        hours += a.hours;
        billableHours += a.billableHours;
        const entry = byClient.get(a.topClientId) ?? { name: a.topClient, hours: 0 };
        entry.hours += a.hours;
        byClient.set(a.topClientId, entry);
      }
      const dominant = dominantClient(byClient);
      return {
        app,
        hours,
        billableHours,
        topClient: dominant.name,
        topClientId: dominant.id,
        sites: groupActivitiesBySite(items),
      };
    })
    .sort((x, y) => y.hours - x.hours);
}
