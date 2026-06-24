import type { AWEvent, Client, MappingRule, UsageEvent } from "@/lib/types";

export const clients: Client[] = [
  { id: 1, name: "Internal / Admin", billableRate: 0, color: "gray" },
  { id: 2, name: "Acme Corp", billableRate: 150, color: "blue" },
  { id: 3, name: "Globex", billableRate: 120, color: "emerald" },
];

export const rules: MappingRule[] = [
  // Client-specific PM tool under client login (high priority).
  {
    id: 10,
    match: { urlDomain: "acme.atlassian.net" },
    clientId: 2,
    project: "Jira",
    billable: true,
    priority: 50,
  },
  {
    id: 11,
    match: { urlDomain: "globex.monday.com" },
    clientId: 3,
    project: "Monday",
    billable: true,
    priority: 50,
  },
  // Internal apps (seeded defaults, lower priority).
  {
    id: 20,
    match: { app: "ms-teams.exe" },
    clientId: 1,
    project: "Admin",
    billable: false,
    priority: 100,
  },
  {
    id: 21,
    match: { app: "OUTLOOK.EXE" },
    clientId: 1,
    project: "Admin",
    billable: false,
    priority: 100,
  },
  {
    id: 22,
    match: { urlDomain: "outlook.office.com" },
    clientId: 1,
    project: "Admin",
    billable: false,
    priority: 100,
  },
];

export function usage(partial: Partial<UsageEvent>): UsageEvent {
  return {
    app: "chrome.exe",
    title: "",
    duration: 600,
    timestamp: "2026-06-23T09:00:00.000Z",
    ...partial,
  };
}

export function awEvent(
  timestamp: string,
  duration: number,
  data: Record<string, unknown>,
): AWEvent {
  return { timestamp, duration, data };
}
