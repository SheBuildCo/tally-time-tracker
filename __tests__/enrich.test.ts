import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

// Mock the SDK so no real network call happens, and the DB so resolveApiKey
// doesn't touch a database (we drive the key via the env var instead).
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { create: mockCreate } })),
}));
vi.mock("@/lib/db", () => ({ getSetting: () => null }));

import { enrichDistinct, ENRICH_MODEL, type EnrichInput } from "@/lib/enrich";

const INPUTS: EnrichInput[] = [
  {
    raw: "maasgroup.looplogics.com",
    kind: "site",
    host: "maasgroup.looplogics.com",
    title: "Dashboard",
    app: "comet.exe",
    sampleSeconds: 1200,
  },
  {
    raw: "acme.looplogics.com",
    kind: "site",
    host: "acme.looplogics.com",
    title: "Dashboard",
    app: "comet.exe",
    sampleSeconds: 600,
  },
];

function reply(items: unknown[]) {
  return {
    content: [{ type: "text", text: JSON.stringify({ items }) }],
  };
}

const CTX = { clientNames: ["MaasGroup", "Acme"] };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("enrichDistinct", () => {
  it("maps results back by raw and drops unknown / malformed items", async () => {
    mockCreate.mockResolvedValue(
      reply([
        {
          raw: "maasgroup.looplogics.com",
          cleanedLabel: "MaasGroup — LoopLogics",
          isPerClientSubdomain: true,
          suggestedUrlDomain: "maasgroup.looplogics.com",
          suggestedClientName: "MaasGroup",
          confidence: 0.95,
        },
        // unknown raw the model invented — dropped
        {
          raw: "evil.example.com",
          cleanedLabel: "X",
          isPerClientSubdomain: false,
          suggestedUrlDomain: null,
          suggestedClientName: null,
          confidence: 0.5,
        },
        // missing/blank cleanedLabel — dropped
        {
          raw: "acme.looplogics.com",
          cleanedLabel: "",
          isPerClientSubdomain: true,
          suggestedUrlDomain: "acme.looplogics.com",
          suggestedClientName: "Acme",
          confidence: 0.9,
        },
      ]),
    );

    const out = await enrichDistinct(INPUTS, CTX);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      raw: "maasgroup.looplogics.com",
      kind: "site",
      isPerClientSubdomain: true,
      suggestedUrlDomain: "maasgroup.looplogics.com",
      suggestedClientName: "MaasGroup",
      confidence: 0.95,
    });
  });

  it("sends the configured model and no sampling/thinking params", async () => {
    mockCreate.mockResolvedValue(reply([]));
    await enrichDistinct(INPUTS, CTX);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe(ENRICH_MODEL);
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.budget_tokens).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("returns [] without constructing a client when no key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await enrichDistinct(INPUTS, CTX);
    expect(out).toEqual([]);
    expect(Anthropic).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("degrades to [] when the SDK throws", async () => {
    mockCreate.mockRejectedValue(new Error("rate limited"));
    const out = await enrichDistinct(INPUTS, CTX);
    expect(out).toEqual([]);
  });

  it("returns [] for empty input without calling the API", async () => {
    const out = await enrichDistinct([], CTX);
    expect(out).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
