import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiAssistantEvent, generateAiRequestCorrelationId } from "@/lib/ai/logging-policy";

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
