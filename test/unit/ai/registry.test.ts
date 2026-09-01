import { afterEach, describe, expect, it, vi } from "vitest";

// Each test re-imports a fresh module instance (vi.resetModules) so the
// registry's own module-level Map never leaks a registration from one
// test into another — the registry has no exported reset function by
// design (a real deployment never needs one; only tests do).
describe("AI tool registry", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("starts empty — Batch 1A registers zero tools", async () => {
    const { getRegisteredAiTools } = await import("@/lib/ai/tools/registry");
    expect(getRegisteredAiTools()).toEqual([]);
  });

  it("registers a read-only tool successfully and makes it retrievable by name", async () => {
    const { registerAiTool, getRegisteredAiTools, getAiToolByName } = await import("@/lib/ai/tools/registry");
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
    expect(getRegisteredAiTools()).toHaveLength(1);
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
