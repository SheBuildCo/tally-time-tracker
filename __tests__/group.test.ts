import { describe, expect, it } from "vitest";
import { groupActivitiesBySite } from "@/lib/group";
import type { ActivitySummary } from "@/lib/analytics";

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    label: "x",
    app: "comet.exe",
    host: "",
    hours: 1,
    billableHours: 0,
    topClient: "",
    ...over,
  };
}

describe("groupActivitiesBySite", () => {
  it("groups by host and sums hours, sorted by hours desc", () => {
    const groups = groupActivitiesBySite([
      act({ label: "Tab A", host: "maasgroup.looplogics.com", hours: 2, billableHours: 2, topClient: "MaasGroup" }),
      act({ label: "Tab B", host: "maasgroup.looplogics.com", hours: 1, billableHours: 1, topClient: "MaasGroup" }),
      act({ label: "HN", host: "news.ycombinator.com", hours: 5, topClient: "Unassigned" }),
    ]);

    expect(groups).toHaveLength(2);
    // ycombinator (5h) ranks above looplogics (3h)
    expect(groups[0].site).toBe("news.ycombinator.com");
    expect(groups[0].hours).toBe(5);

    const loop = groups[1];
    expect(loop.site).toBe("maasgroup.looplogics.com");
    expect(loop.hours).toBe(3);
    expect(loop.billableHours).toBe(3);
    expect(loop.topClient).toBe("MaasGroup");
    // items sorted by hours desc within the group
    expect(loop.items.map((i) => i.label)).toEqual(["Tab A", "Tab B"]);
  });

  it("falls back to app name when there is no host", () => {
    const groups = groupActivitiesBySite([
      act({ label: "Inbox", app: "OUTLOOK.EXE", host: "", hours: 2 }),
    ]);
    expect(groups[0].site).toBe("OUTLOOK.EXE");
  });

  it("picks the dominant client by hours within a site", () => {
    const groups = groupActivitiesBySite([
      act({ host: "shared.example.com", hours: 1, topClient: "Acme" }),
      act({ host: "shared.example.com", hours: 4, topClient: "Globex" }),
    ]);
    expect(groups[0].topClient).toBe("Globex");
  });

  it("returns [] for no activities", () => {
    expect(groupActivitiesBySite([])).toEqual([]);
  });
});
