// Site-first grouping: collapse fine-grained activities (specific tabs/chats)
// into the site (host) they happened on, so the UI can lead with the site and
// expand to reveal the specific items. Pure — trivially unit-testable.

import type { ActivitySummary } from "./analytics";

export interface SiteGroup {
  site: string; // host when known, else the app name — the coarse "where"
  hours: number;
  billableHours: number;
  topClient: string; // dominant client across the group's items (by hours)
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
      byClient: Map<string, number>; // client -> hours, to pick the dominant one
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
    if (a.topClient) {
      g.byClient.set(a.topClient, (g.byClient.get(a.topClient) ?? 0) + a.hours);
    }
  }

  return [...groups.values()]
    .map((g) => ({
      site: g.site,
      hours: g.hours,
      billableHours: g.billableHours,
      topClient: dominantClient(g.byClient),
      items: g.items.sort((x, y) => y.hours - x.hours),
    }))
    .sort((x, y) => y.hours - x.hours);
}

function dominantClient(byClient: Map<string, number>): string {
  let best = "";
  let bestHours = -1;
  for (const [client, hours] of byClient) {
    if (hours > bestHours) {
      best = client;
      bestHours = hours;
    }
  }
  return best;
}
