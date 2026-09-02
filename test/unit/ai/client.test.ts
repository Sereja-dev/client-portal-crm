import { afterEach, describe, expect, it, vi } from "vitest";
import { askAiAssistant, getAiAssistantErrorCopy } from "@/lib/ai/client";

/**
 * AI Assistant staff drawer/UI batch — client.ts's own unit tests.
 * Pure logic, mocked global fetch — no DOM needed at all, unlike the
 * component tests (see ai-assistant-panel.test.tsx's own header comment
 * for why the component layer can't be tested this thoroughly).
 */

function mockFetchOnce(response: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("askAiAssistant — request shape", () => {
  it("POSTs to the exact endpoint with Content-Type: application/json and a body of exactly { message }", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ answer: "hi" }) });
    await askAiAssistant("hello there");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/ai/assistant");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ message: "hello there" });
    expect(Object.keys(JSON.parse(init.body))).toEqual(["message"]);
  });

  it("passes the given AbortSignal through to fetch", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ answer: "hi" }) });
    const controller = new AbortController();
    await askAiAssistant("hi", controller.signal);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
  });
});

describe("askAiAssistant — success", () => {
  it("returns { ok: true, answer } for a valid 200 response", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ answer: "The answer." }) });
    const result = await askAiAssistant("hi");
    expect(result).toEqual({ ok: true, answer: "The answer." });
  });
});

describe("askAiAssistant — malformed 200 response is never trusted", () => {
  it("a 200 with no answer field is a generic failure, not a fabricated success", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });
    const result = await askAiAssistant("hi");
    expect(result.ok).toBe(false);
  });

  it("a 200 with answer as a non-string is a generic failure", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ answer: 12345 }) });
    const result = await askAiAssistant("hi");
    expect(result.ok).toBe(false);
  });

  it("a 200 with an extra unexpected field alongside a valid answer is still treated as success (extra fields are simply not read, never rejected)", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ answer: "hi", provider: "mock", usage: {} }) });
    const result = await askAiAssistant("hi");
    expect(result).toEqual({ ok: true, answer: "hi" });
  });

  it("a 200 whose body is not valid JSON is a generic failure, never thrown", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    const result = await askAiAssistant("hi");
    expect(result).toEqual({ ok: false, status: 200 });
  });

  it("a 200 whose body is a plain string, not an object, is a generic failure", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => "just a string" });
    const result = await askAiAssistant("hi");
    expect(result.ok).toBe(false);
  });

  it("a 200 whose body is null is a generic failure", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => null });
    const result = await askAiAssistant("hi");
    expect(result.ok).toBe(false);
  });
});

describe("askAiAssistant — non-200 statuses preserved generically", () => {
  it.each([400, 401, 403, 429, 500, 502, 503])("status %i is returned as { ok: false, status }", async (status) => {
    mockFetchOnce({ ok: false, status });
    const result = await askAiAssistant("hi");
    expect(result).toEqual({ ok: false, status });
  });
});

describe("askAiAssistant — network failure", () => {
  it("a fetch-level throw (offline, DNS, CORS) normalizes to { ok: false, status: 0 }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const result = await askAiAssistant("hi");
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it("a genuine AbortError propagates (thrown), never silently normalized to a network-failure result — the caller must be able to distinguish deliberate cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")),
    );
    await expect(askAiAssistant("hi")).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getAiAssistantErrorCopy — generic, product-facing, never raw", () => {
  it.each([
    [400, "That message couldn't be sent. Try rephrasing it."],
    [401, "Your session has expired. Reload the page and sign in again."],
    [403, "AI Assistant isn't available for this account."],
    [429, "You've sent a lot of requests. Try again in a little while."],
    [502, "AI Assistant is temporarily unavailable. Try again in a moment."],
    [503, "AI Assistant is currently unavailable."],
    [0, "Couldn't reach the server. Check your connection and try again."],
    [500, "Something went wrong. Try again."],
    [418, "Something went wrong. Try again."], // any unmapped status falls back to the generic copy
  ])("status %i -> %s", (status, expected) => {
    expect(getAiAssistantErrorCopy(status)).toBe(expected);
  });

  it("never contains a status code, an internal error kind, or a rate-limit counter/reset time in any mapped string", () => {
    for (const status of [400, 401, 403, 429, 500, 502, 503, 0]) {
      const copy = getAiAssistantErrorCopy(status);
      expect(copy).not.toMatch(/\b(limit_exceeded|timeout|provider_error|invalid_response|ref_leak|empty_answer)\b/);
      expect(copy).not.toMatch(/\d{3}/); // no 3-digit status code embedded
    }
  });
});
