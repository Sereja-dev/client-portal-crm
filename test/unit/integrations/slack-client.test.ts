import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// src/lib/integrations/slack-client.ts imports the real "server-only"
// marker package, which throws outside Next's own build — same reasoning
// test/unit/invoice-pdf-logo.test.ts's own identical mock documents.
vi.mock("server-only", () => ({}));

import { sendSlackMessage } from "@/lib/integrations/slack-client";

const URL_UNDER_TEST = "https://hooks.slack.com/services/T000/B000/XXXX";

function jsonResponse(status: number, headers: Record<string, string> = {}, body = "ok"): Response {
  return new Response(body, { status, headers });
}

describe("integrations/slack-client sendSlackMessage", () => {
  const originalFetch = globalThis.fetch;
  const originalTestMode = process.env.TEST_MODE;
  const originalFixture = process.env.TEST_SLACK_FIXTURE_BASE_URL;

  beforeEach(() => {
    delete process.env.TEST_MODE;
    delete process.env.TEST_SLACK_FIXTURE_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalTestMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = originalTestMode;
    if (originalFixture === undefined) delete process.env.TEST_SLACK_FIXTURE_BASE_URL;
    else process.env.TEST_SLACK_FIXTURE_BASE_URL = originalFixture;
    vi.restoreAllMocks();
  });

  it("returns success on HTTP 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200));
    const result = await sendSlackMessage(URL_UNDER_TEST, "hello");
    expect(result).toEqual({ outcome: "success" });
  });

  it("sends a POST with JSON content-type and the text in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    globalThis.fetch = fetchMock;
    await sendSlackMessage(URL_UNDER_TEST, "hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(URL_UNDER_TEST);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ text: "hello world" });
    expect(init.redirect).toBe("manual");
  });

  it("classifies 429 as retryable with a bounded Retry-After", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(429, { "retry-after": "30" }, "rate_limited"));
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "retryable", code: "SLACK_RATE_LIMITED", retryAfterMs: 30_000 });
  });

  it("ignores an out-of-bounds Retry-After value", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(429, { "retry-after": "999999" }));
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "retryable", code: "SLACK_RATE_LIMITED", retryAfterMs: undefined });
  });

  it("classifies 5xx as retryable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, {}, "server_error"));
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "retryable", code: "SLACK_SERVER_ERROR" });
  });

  it("classifies other 4xx as permanent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(404, {}, "channel_not_found"));
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "permanent", code: "SLACK_CLIENT_ERROR" });
  });

  it("classifies a redirect (opaqueredirect) as permanent and never follows it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ type: "opaqueredirect", status: 0, headers: new Headers(), body: null });
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "permanent", code: "SLACK_REDIRECT_REJECTED" });
  });

  it("classifies a thrown TimeoutError as retryable SLACK_TIMEOUT", async () => {
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "TimeoutError";
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr);
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "retryable", code: "SLACK_TIMEOUT" });
  });

  it("classifies a generic network failure as retryable SLACK_NETWORK_ERROR", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await sendSlackMessage(URL_UNDER_TEST, "x");
    expect(result).toEqual({ outcome: "retryable", code: "SLACK_NETWORK_ERROR" });
  });

  it("never throws, even on an unexpected fetch rejection", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(sendSlackMessage(URL_UNDER_TEST, "x")).resolves.toBeDefined();
  });

  // The TEST_MODE-redirect branch itself (src/lib/integrations/
  // slack-client.ts's own resolveSendTarget) is NOT exercised here on
  // purpose: src/lib/test-mode.ts's TEST_MODE constant is read exactly
  // once, at module-load time, for the whole process — toggling
  // process.env.TEST_MODE from inside a running test has no effect on
  // the already-frozen value this module imported, so this unit test
  // process (TEST_MODE always "0" here) cannot exercise the "on" branch
  // at all. That branch is proven instead at the E2E layer
  // (test/e2e/integrations.spec.ts), where TEST_MODE=1 is baked into the
  // spawned app process's own environment before it ever starts — the
  // same honest "prove it where it's actually provable" discipline this
  // app's PGlite-concurrency tests already follow.
  it("does NOT redirect the outbound target in this process (TEST_MODE is off here), even if the fixture var happens to be set", async () => {
    process.env.TEST_SLACK_FIXTURE_BASE_URL = "http://127.0.0.1:39999";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    globalThis.fetch = fetchMock;
    await sendSlackMessage(URL_UNDER_TEST, "x");
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(URL_UNDER_TEST);
  });
});
