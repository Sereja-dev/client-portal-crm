import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/lib/ai/providers/mock";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiRequest } from "@/lib/ai/provider";

const BASE_REQUEST: AiRequest = {
  systemPrompt: "system prompt",
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  maxOutputTokens: 100,
  timeoutMs: 5000,
};

describe("MockAiProvider", () => {
  it("returns a deterministic scripted text response", async () => {
    const provider = new MockAiProvider([{ kind: "text", text: "Hello there." }]);
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      kind: "text",
      text: "Hello there.",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("returns a deterministic, normalized tool-call response", async () => {
    const provider = new MockAiProvider([{ kind: "toolCall", call: { toolName: "exampleTool", args: { q: "x" } } }]);
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      kind: "toolCall",
      call: { toolName: "exampleTool", args: { q: "x" } },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("allows a scripted step to override individual usage fields", async () => {
    const provider = new MockAiProvider([{ kind: "text", text: "hi", usage: { totalTokens: 999 } }]);
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      kind: "text",
      text: "hi",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 999 },
    });
  });

  it("throws a normalized AiProviderError for a scripted timeout", async () => {
    const provider = new MockAiProvider([{ kind: "error", errorKind: "timeout" }]);
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "timeout" });
    await expect(new MockAiProvider([{ kind: "error", errorKind: "timeout" }]).complete(BASE_REQUEST)).rejects.toBeInstanceOf(AiProviderError);
  });

  it("throws a normalized AiProviderError for scripted unavailability", async () => {
    const provider = new MockAiProvider([{ kind: "error", errorKind: "unavailable" }]);
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("supports every normalized error kind", async () => {
    for (const errorKind of ["timeout", "rate_limited", "unavailable", "invalid_request", "unknown"] as const) {
      const provider = new MockAiProvider([{ kind: "error", errorKind }]);
      await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ kind: errorKind });
    }
  });

  it("consumes scripted steps in order across multiple calls", async () => {
    const provider = new MockAiProvider([
      { kind: "text", text: "first" },
      { kind: "toolCall", call: { toolName: "t", args: {} } },
      { kind: "text", text: "third" },
    ]);
    expect(provider.remainingSteps()).toBe(3);
    await expect(provider.complete(BASE_REQUEST)).resolves.toMatchObject({ kind: "text", text: "first" });
    expect(provider.remainingSteps()).toBe(2);
    await expect(provider.complete(BASE_REQUEST)).resolves.toMatchObject({ kind: "toolCall" });
    await expect(provider.complete(BASE_REQUEST)).resolves.toMatchObject({ kind: "text", text: "third" });
    expect(provider.remainingSteps()).toBe(0);
  });

  it("throws loudly, not silently, once the script is exhausted", async () => {
    const provider = new MockAiProvider([{ kind: "text", text: "only one" }]);
    await provider.complete(BASE_REQUEST);
    await expect(provider.complete(BASE_REQUEST)).rejects.toThrow(/script exhausted/i);
  });

  it("two independent instances never share scripted state", async () => {
    const a = new MockAiProvider([{ kind: "text", text: "A" }]);
    const b = new MockAiProvider([{ kind: "text", text: "B" }]);
    const [resultA, resultB] = await Promise.all([a.complete(BASE_REQUEST), b.complete(BASE_REQUEST)]);
    expect(resultA).toMatchObject({ text: "A" });
    expect(resultB).toMatchObject({ text: "B" });
  });

  it("has no stream implementation — MVP orchestration is non-streaming only", () => {
    const provider = new MockAiProvider([{ kind: "text", text: "x" }]);
    expect(provider.stream).toBeUndefined();
  });
});
