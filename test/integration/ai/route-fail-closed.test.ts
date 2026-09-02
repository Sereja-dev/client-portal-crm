import { describe, expect, it, vi } from "vitest";

/**
 * AI Assistant orchestration + Route Handler batch — the merge-critical
 * Production fail-closed proof, at the integration tier. Deliberately
 * NO local `vi.mock("@/lib/test-mode", ...)` override in this file — the
 * shared integration harness (test/integration/setup-mocks.ts's own
 * header comment: "TEST_MODE ... deliberately not set anywhere in this
 * integration harness") already leaves TEST_MODE unset by default,
 * which is exactly Production's own real-world state. This file exists
 * specifically to prove the route's own §A fail-closed gate under that
 * exact condition — no fixtures are seeded and no auth identity is ever
 * configured, because none of that should ever be reached.
 */

vi.mock("@/lib/ai/request-context", () => ({
  getAiAssistantRequestContext: vi.fn(async () => {
    throw new Error("getAiAssistantRequestContext must never be called when the AI provider is unconfigured (TEST_MODE off).");
  }),
}));

const { getAiAssistantRequestContext } = await import("@/lib/ai/request-context");
const { POST } = await import("@/app/api/ai/assistant/route");

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/ai/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/assistant — Production fail-closed (TEST_MODE off)", () => {
  it("returns a generic 503 without ever calling auth, orchestration, or the database", async () => {
    const response = await POST(jsonRequest({ message: "hello" }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "The AI Assistant is not available right now." });
    expect(getAiAssistantRequestContext).not.toHaveBeenCalled();
  });

  it("the 503 response reveals nothing about provider configuration, TEST_MODE, auth state, or organization existence", async () => {
    const response = await POST(jsonRequest({ message: "hello" }));
    const body = await response.json();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("test_mode");
    expect(raw).not.toContain("provider");
    expect(raw).not.toContain("organization");
    expect(raw).not.toContain("auth");
    expect(raw).not.toContain("mock");
  });

  it("sets Cache-Control: private, no-store even on the fail-closed response", async () => {
    const response = await POST(jsonRequest({ message: "hello" }));
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns the same generic 503 for a completely malformed body too — the fail-closed gate runs before body validation", async () => {
    const response = await POST(
      new Request("http://127.0.0.1/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json at all" }),
    );
    expect(response.status).toBe(503);
    expect(getAiAssistantRequestContext).not.toHaveBeenCalled();
  });
});
