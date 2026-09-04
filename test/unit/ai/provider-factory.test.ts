import { afterEach, describe, expect, it, vi } from "vitest";

// Deliberately no top-level `import { AiProviderError } from
// "@/lib/ai/provider"` here — every test below calls vi.resetModules()
// and re-imports fresh, which would make a top-level-imported class
// reference a DIFFERENT module instance than the one
// unconfigured-provider.ts actually throws from, breaking `instanceof`
// checks for reasons that have nothing to do with real behavior (the
// same "check .kind, not instanceof, across a resetModules() boundary"
// discipline test/unit/billing-provider-registry.test.ts's own tests
// already follow by checking `.kind` on the resolved adapter rather than
// an instance check).
//
// provider-factory.ts imports the real "server-only" marker package —
// see test/unit/billing-provider-registry.test.ts's own header comment
// for why this needs neutralizing here rather than disabling the guard
// globally.
vi.mock("server-only", () => ({}));

/**
 * AI Assistant orchestration + Route Handler batch. Mirrors
 * test/unit/billing-provider-registry.test.ts's own established
 * module/env isolation discipline exactly: TEST_MODE is a top-level
 * const computed once at import time (src/lib/test-mode.ts), so every
 * test here calls vi.resetModules() + a fresh dynamic import() after
 * stubbing the env var, and vi.unstubAllEnvs() runs after every test —
 * never mutating global process state in a way that could leak into a
 * later, unrelated test file.
 */

async function importFresh() {
  vi.resetModules();
  return import("@/lib/ai/providers/provider-factory");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAiAssistantAvailable / getAiProviderAdapter — TEST_MODE gating", () => {
  it("resolves unavailable, and to the unconfigured provider, when TEST_MODE is unset", async () => {
    vi.stubEnv("TEST_MODE", "");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(false);

    const provider = getAiProviderAdapter([{ kind: "text", text: "should never be reachable" }]);
    await expect(
      provider.complete({ systemPrompt: "s", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "AiProviderError", kind: "unavailable" });
  });

  it('resolves unavailable when TEST_MODE is any value other than exactly "1"', async () => {
    for (const value of ["0", "true", "TEST", "yes"]) {
      vi.stubEnv("TEST_MODE", value);
      const { isAiAssistantAvailable } = await importFresh();
      expect(isAiAssistantAvailable()).toBe(false);
    }
  });

  it("resolves available, and to a real MockAiProvider, when TEST_MODE is exactly \"1\"", async () => {
    vi.stubEnv("TEST_MODE", "1");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(true);

    const provider = getAiProviderAdapter([{ kind: "text", text: "mock answer" }]);
    const result = await provider.complete({ systemPrompt: "s", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1000 });
    expect(result).toMatchObject({ kind: "text", text: "mock answer" });
  });
});

describe("the unconfigured provider fails closed", () => {
  it("never produces a fake answer — complete() always rejects with AiProviderError('unavailable')", async () => {
    vi.stubEnv("TEST_MODE", "");
    const { getAiProviderAdapter } = await importFresh();
    const provider = getAiProviderAdapter([]);
    await expect(
      provider.complete({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }], tools: [], maxOutputTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "AiProviderError", kind: "unavailable" });
  });

  it("has no stream implementation", async () => {
    vi.stubEnv("TEST_MODE", "");
    const { getAiProviderAdapter } = await importFresh();
    const provider = getAiProviderAdapter([]);
    expect(provider.stream).toBeUndefined();
  });

  it("makes no network call when resolving in either state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("getAiProviderAdapter() must never make a network call during resolution");
    });

    vi.stubEnv("TEST_MODE", "");
    const unconfiguredModule = await importFresh();
    expect(() => unconfiguredModule.getAiProviderAdapter([])).not.toThrow();

    vi.stubEnv("TEST_MODE", "1");
    const mockModule = await importFresh();
    expect(() => mockModule.getAiProviderAdapter([{ kind: "text", text: "x" }])).not.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("no client input influences provider choice", () => {
  it("the scripted-steps argument only ever affects the MOCK path's own script — it cannot make the unconfigured path resolve to a real answer", async () => {
    vi.stubEnv("TEST_MODE", "");
    const { getAiProviderAdapter } = await importFresh();
    // Even an argument shaped like a "real" script has no effect outside
    // TEST_MODE — the unconfigured provider ignores its constructor
    // argument entirely (there is none) and always fails closed.
    const provider = getAiProviderAdapter([{ kind: "text", text: "attacker-controlled-looking text" }]);
    await expect(
      provider.complete({ systemPrompt: "s", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "AiProviderError", kind: "unavailable" });
  });
});

describe("isAiAssistantAvailable / getAiProviderAdapter — AI_PROVIDER / AQENRA_OPENAI_API_KEY resolution", () => {
  it("resolves unavailable/unconfigured when AI_PROVIDER is entirely unset (the same disabled-by-default state as before this batch)", async () => {
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(false);
    const provider = getAiProviderAdapter([]);
    expect(provider.providerId).toBe("unconfigured");
    await expect(
      provider.complete({ systemPrompt: "s", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "AiProviderError", kind: "unavailable" });
  });

  it("key presence ALONE never enables anything: AQENRA_OPENAI_API_KEY set with AI_PROVIDER unset still resolves unavailable", async () => {
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "sk-real-looking-key");
    const { isAiAssistantAvailable } = await importFresh();
    expect(isAiAssistantAvailable()).toBe(false);
  });

  it('resolves unavailable/unconfigured for a deterministic configuration failure: AI_PROVIDER="openai" but the key is missing', async () => {
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(false);
    const provider = getAiProviderAdapter([]);
    expect(provider.providerId).toBe("unconfigured");
  });

  it('resolves the real OpenAI adapter when AI_PROVIDER="openai" and a real-looking key are both present', async () => {
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "sk-real-looking-key");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(true);
    const provider = getAiProviderAdapter([]);
    expect(provider.providerId).toBe("openai");
    expect(provider.modelId).toBe("gpt-5.6-luna");
  });

  it("TEST_MODE takes priority over a real, fully valid OpenAI config — the mock is still what's returned", async () => {
    vi.stubEnv("TEST_MODE", "1");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "sk-real-looking-key");
    const { isAiAssistantAvailable, getAiProviderAdapter } = await importFresh();

    expect(isAiAssistantAvailable()).toBe(true);
    const provider = getAiProviderAdapter([{ kind: "text", text: "mock answer" }]);
    expect(provider.providerId).toBe("mock");
  });

  it("resolving the real OpenAI adapter makes no network call — constructing the SDK client is pure, synchronous setup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("getAiProviderAdapter() must never make a network call during resolution");
    });
    vi.stubEnv("TEST_MODE", "");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "sk-real-looking-key");
    const { getAiProviderAdapter } = await importFresh();
    expect(() => getAiProviderAdapter([])).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
