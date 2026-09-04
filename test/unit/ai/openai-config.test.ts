import { afterEach, describe, expect, it, vi } from "vitest";

// src/lib/ai/providers/openai-config.ts imports the real "server-only"
// marker package — see test/unit/billing-paddle-config.test.ts's own
// header comment for why this needs neutralizing here rather than
// disabling the guard globally.
vi.mock("server-only", () => ({}));

async function importFresh() {
  vi.resetModules();
  return import("@/lib/ai/providers/openai-config");
}

describe("getOpenAiProviderConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves "disabled" when AI_PROVIDER is entirely unset', async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "disabled" });
  });

  it('resolves "disabled" when AI_PROVIDER is exactly the literal "disabled"', async () => {
    vi.stubEnv("AI_PROVIDER", "disabled");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "a-real-looking-key");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "disabled" });
  });

  it('resolves "disabled" for any value other than exactly "openai" after trimming (case-sensitive, never guessed/normalized)', async () => {
    for (const value of ["OpenAI", "OPENAI", "anthropic", "true", "1"]) {
      vi.stubEnv("AI_PROVIDER", value);
      vi.stubEnv("AQENRA_OPENAI_API_KEY", "a-real-looking-key");
      const { getOpenAiProviderConfig } = await importFresh();
      expect(getOpenAiProviderConfig()).toEqual({ status: "disabled" });
    }
  });

  it('key presence ALONE never enables anything: AQENRA_OPENAI_API_KEY set but AI_PROVIDER unset resolves "disabled"', async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "a-real-looking-key");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "disabled" });
  });

  it('resolves "misconfigured" — a deterministic, distinct failure — when AI_PROVIDER="openai" but the key is missing', async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "misconfigured" });
  });

  it('resolves "misconfigured" when the key is whitespace-only', async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "   ");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "misconfigured" });
  });

  it('trims surrounding whitespace on AI_PROVIDER itself (a trailing newline from a .env file is not a "different" value)', async () => {
    vi.stubEnv("AI_PROVIDER", " openai \n");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "sk-real-looking-key");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "configured", apiKey: "sk-real-looking-key" });
  });

  it('resolves "configured" with the trimmed key when both AI_PROVIDER="openai" and a real key are present', async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "  sk-real-looking-key  ");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "configured", apiKey: "sk-real-looking-key" });
  });

  it("never falls back to a generic OPENAI_API_KEY when AQENRA_OPENAI_API_KEY is unset", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AQENRA_OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-some-unrelated-developer-key");
    const { getOpenAiProviderConfig } = await importFresh();
    expect(getOpenAiProviderConfig()).toEqual({ status: "misconfigured" });
  });

  it("makes no network call while resolving in any state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("getOpenAiProviderConfig() must never make a network call");
    });
    for (const [provider, key] of [
      ["", ""],
      ["openai", ""],
      ["openai", "sk-real-looking-key"],
    ] as const) {
      vi.stubEnv("AI_PROVIDER", provider);
      vi.stubEnv("AQENRA_OPENAI_API_KEY", key);
      const { getOpenAiProviderConfig } = await importFresh();
      expect(() => getOpenAiProviderConfig()).not.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
