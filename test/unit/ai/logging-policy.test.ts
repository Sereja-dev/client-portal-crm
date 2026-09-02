import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiAssistantEvent, generateAiRequestCorrelationId } from "@/lib/ai/logging-policy";
import type { AiUsage } from "@/lib/ai/provider";

describe("logAiAssistantEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid metadata-only event and logs it", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logAiAssistantEvent({ timestamp: "2026-01-01T00:00:00.000Z", category: "success", toolName: "exampleTool", latencyMs: 42 });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload] = spy.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      timestamp: "2026-01-01T00:00:00.000Z",
      category: "success",
      toolName: "exampleTool",
      latencyMs: 42,
    });
  });

  it("rejects a prompt field at runtime, even if the caller bypasses the type system", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const withPrompt = { timestamp: "t", category: "success", prompt: "what the user typed" } as unknown as Parameters<typeof logAiAssistantEvent>[0];
    expect(() => logAiAssistantEvent(withPrompt)).toThrow(/unexpected field "prompt"/i);
  });

  it("rejects a response field at runtime", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const withResponse = { timestamp: "t", category: "success", response: "the assistant's answer" } as unknown as Parameters<typeof logAiAssistantEvent>[0];
    expect(() => logAiAssistantEvent(withResponse)).toThrow(/unexpected field "response"/i);
  });

  it("rejects toolArgs and toolResult fields at runtime", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const withArgs = { timestamp: "t", category: "success", toolArgs: { q: "x" } } as unknown as Parameters<typeof logAiAssistantEvent>[0];
    const withResult = { timestamp: "t", category: "success", toolResult: { rows: [] } } as unknown as Parameters<typeof logAiAssistantEvent>[0];
    expect(() => logAiAssistantEvent(withArgs)).toThrow(/unexpected field "toolArgs"/i);
    expect(() => logAiAssistantEvent(withResult)).toThrow(/unexpected field "toolResult"/i);
  });

  it("rejects raw organizationId/userId/email fields at runtime", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const key of ["organizationId", "userId", "email"]) {
      const withIdentity = { timestamp: "t", category: "success", [key]: "some-value" } as unknown as Parameters<typeof logAiAssistantEvent>[0];
      expect(() => logAiAssistantEvent(withIdentity)).toThrow(new RegExp(`unexpected field "${key}"`, "i"));
    }
  });

  it("accepts errorKind alongside category: 'error'", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logAiAssistantEvent({ timestamp: "t", category: "error", errorKind: "timeout" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // --- Hardening finding A: nested-object bypass, closed ---
  // Every case below deliberately bypasses TypeScript (an `as unknown as
  // AiUsage` cast, the same pattern the file's own pre-existing tests
  // above already use via `as unknown as Parameters<...>[0]`, rather than
  // a real object literal TypeScript's own excess-property check would
  // catch) to prove the *runtime* validator itself closes the gap — not
  // merely that TypeScript would have caught it.

  it("accepts valid usage and logs it", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logAiAssistantEvent({ timestamp: "t", category: "success", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload] = spy.mock.calls[0];
    expect(JSON.parse(payload as string).usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("accepts usage with a zero count (a legitimate, non-negative value)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      logAiAssistantEvent({ timestamp: "t", category: "success", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    ).not.toThrow();
  });

  it("rejects an extra nested key smuggled inside usage: usage.prompt", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const smuggled = { promptTokens: 1, completionTokens: 2, totalTokens: 3, prompt: "secret user prompt" } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: smuggled })).toThrow(/usage/i);
  });

  it("rejects usage.response", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const smuggled = { promptTokens: 1, completionTokens: 2, totalTokens: 3, response: "the assistant's answer" } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: smuggled })).toThrow(/usage/i);
  });

  it("rejects usage.organizationId", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const smuggled = { promptTokens: 1, completionTokens: 2, totalTokens: 3, organizationId: "11111111-1111-1111-1111-111111111111" } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: smuggled })).toThrow(/usage/i);
  });

  it("rejects a nested object smuggled as an unknown usage key (usage.nested = {...})", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const smuggled = { promptTokens: 1, completionTokens: 2, totalTokens: 3, nested: { toolArgs: { q: "x" } } } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: smuggled })).toThrow(/usage/i);
  });

  it("rejects any other unknown key hidden inside usage", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const smuggled = { promptTokens: 1, completionTokens: 2, totalTokens: 3, debugToolResult: { rows: [] } } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: smuggled })).toThrow(/usage/i);
  });

  it("rejects usage with a string where a number is expected (promptTokens: \"1\")", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const wrongType = { promptTokens: "1", completionTokens: 2, totalTokens: 3 } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: wrongType })).toThrow(/usage/i);
  });

  it("rejects usage with a nested object where a number is expected (totalTokens: {})", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const wrongType = { promptTokens: 1, completionTokens: 2, totalTokens: {} } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: wrongType })).toThrow(/usage/i);
  });

  it("rejects usage with null where a number is expected (completionTokens: null)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const wrongType = { promptTokens: 1, completionTokens: null, totalTokens: 3 } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: wrongType })).toThrow(/usage/i);
  });

  it("rejects NaN/Infinity/-Infinity token counts", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const bad of [NaN, Infinity, -Infinity]) {
      const wrongValue = { promptTokens: bad, completionTokens: 1, totalTokens: 2 } as unknown as AiUsage;
      expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: wrongValue })).toThrow(/usage/i);
    }
  });

  it("rejects a negative token count", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const negative = { promptTokens: -1, completionTokens: 2, totalTokens: 3 } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: negative })).toThrow(/usage/i);
  });

  it("rejects usage missing a required key (AiUsage has none optional)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const incomplete = { promptTokens: 1, completionTokens: 2 } as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: incomplete })).toThrow(/usage/i);
  });

  it("rejects usage that is an array instead of an object", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const arrayUsage = [1, 2, 3] as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: arrayUsage })).toThrow(/usage/i);
  });

  it("rejects usage that is null", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const nullUsage = null as unknown as AiUsage;
    expect(() => logAiAssistantEvent({ timestamp: "t", category: "success", usage: nullUsage })).toThrow(/usage/i);
  });
});

describe("generateAiRequestCorrelationId", () => {
  it("returns a fresh, unique value on every call", () => {
    const a = generateAiRequestCorrelationId();
    const b = generateAiRequestCorrelationId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });
});
