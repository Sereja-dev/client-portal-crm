import { afterEach, describe, expect, it, vi } from "vitest";

// Each test re-imports a fresh module instance (vi.resetModules) so the
// registry's own module-level Map never leaks a registration from one
// test into another — the registry has no exported reset function by
// design (a real deployment never needs one; only tests do).
//
// AI Assistant Batch 1B.1: the registry module itself now registers
// exactly five real, read-only domain tools at import time (see
// registry.ts's own top-level registerAiTool() calls) — Batch 1A's own
// "starts empty" assertion is updated here to match, and every test
// below that used to assume a zero-tool baseline now asserts relative to
// that fixed baseline instead of an absolute count of 1.
const APPROVED_BATCH_1B1_TOOL_NAMES = [
  "getOrganizationSummary",
  "searchClients",
  "getClientDetail",
  "searchProjects",
  "searchTasks",
] as const;

describe("AI tool registry", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("registers exactly the five approved Batch 1B.1 tools by default — no more, no fewer", async () => {
    const { getRegisteredAiTools } = await import("@/lib/ai/tools/registry");
    const names = getRegisteredAiTools()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([...APPROVED_BATCH_1B1_TOOL_NAMES].sort());
  });

  it("each approved tool is retrievable by name and has a non-empty description/inputSchema", async () => {
    const { getAiToolByName } = await import("@/lib/ai/tools/registry");
    for (const name of APPROVED_BATCH_1B1_TOOL_NAMES) {
      const tool = getAiToolByName(name);
      expect(tool, `expected ${name} to be registered`).toBeDefined();
      expect(tool!.description.length).toBeGreaterThan(0);
      expect(typeof tool!.inputSchema).toBe("object");
    }
  });

  it("registers an additional read-only tool successfully and makes it retrievable by name", async () => {
    const { registerAiTool, getRegisteredAiTools, getAiToolByName } = await import("@/lib/ai/tools/registry");
    const baseline = getRegisteredAiTools().length;
    const tool = {
      name: "exampleReadOnlyTool",
      description: "an example",
      inputSchema: {},
      execute: async (organizationId: string, input: unknown) => {
        void organizationId;
        void input;
        return {};
      },
    };
    registerAiTool(tool);
    expect(getRegisteredAiTools()).toHaveLength(baseline + 1);
    expect(getAiToolByName("exampleReadOnlyTool")).toBe(tool);
  });

  it("rejects a mutation-like tool name — never reaches the registry", async () => {
    const { registerAiTool } = await import("@/lib/ai/tools/registry");
    const mutationTool = {
      name: "createInvoice",
      description: "should never register",
      inputSchema: {},
      execute: async () => ({}),
    };
    expect(() => registerAiTool(mutationTool)).toThrow(/mutation-like/i);
  });

  it("rejects a duplicate tool name", async () => {
    const { registerAiTool } = await import("@/lib/ai/tools/registry");
    const tool = { name: "dupTool", description: "d", inputSchema: {}, execute: async () => ({}) };
    registerAiTool(tool);
    expect(() => registerAiTool(tool)).toThrow(/already registered/i);
  });

  it("rejects re-registering an already-approved Batch 1B.1 tool name", async () => {
    const { registerAiTool } = await import("@/lib/ai/tools/registry");
    expect(() =>
      registerAiTool({ name: "searchClients", description: "d", inputSchema: {}, execute: async () => ({}) }),
    ).toThrow(/already registered/i);
  });

  it("getRegisteredAiTools() returns a frozen array the caller cannot mutate", async () => {
    const { registerAiTool, getRegisteredAiTools } = await import("@/lib/ai/tools/registry");
    registerAiTool({ name: "frozenCheckTool", description: "d", inputSchema: {}, execute: async () => ({}) });
    const tools = getRegisteredAiTools();
    expect(Object.isFrozen(tools)).toBe(true);
    expect(() => {
      // @ts-expect-error — intentionally attempting a mutation the type system already forbids, to prove the runtime also rejects it.
      tools.push({});
    }).toThrow();
  });
});
