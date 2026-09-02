import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route resolves its provider via getAiProviderAdapter()
// (src/lib/ai/providers/provider-factory.ts), which only ever returns a
// real MockAiProvider under TEST_MODE — mocking test-mode.ts here is
// what lets this file exercise the real auth -> rate-limit -> validate
// -> orchestrate -> respond pipeline end to end, against the real (test)
// Postgres. Mirrors test/integration/billing/webhook.test.ts's own
// identical convention.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/test-mode", () => ({ TEST_MODE: true }));

import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";

const { POST } = await import("@/app/api/ai/assistant/route");

const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

function jsonRequest(body: unknown, contentType: string | null = "application/json"): Request {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  return new Request("http://127.0.0.1/api/ai/assistant", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/ai/assistant — integration (TEST_MODE on)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("auth boundary", () => {
    it("no session -> 401 JSON, generic message", async () => {
      const response = await POST(jsonRequest({ message: "hello" }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Not authenticated." });
    });

    it("Portal identity -> 403", async () => {
      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      const response = await POST(jsonRequest({ message: "hello" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Not authorized." });
    });

    it("Platform Admin identity -> 403", async () => {
      const platformAdminEmail = "platform-admin-route-test@example.com";
      process.env.PLATFORM_ADMIN_EMAILS = platformAdminEmail;
      setMockAuthUser({ id: "platform-admin-route-test", email: platformAdminEmail });
      const response = await POST(jsonRequest({ message: "hello" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Not authorized." });
    });

    it("dual identity (Platform Admin allowlisted AND a real staff User/Membership) -> still 403, denied on the Platform Admin check alone", async () => {
      const dualEmail = "dual-platform-admin-staff-route-test@example.com";
      const dualId = randomUUID();
      process.env.PLATFORM_ADMIN_EMAILS = dualEmail;
      await prisma.user.create({ data: { id: dualId, email: dualEmail, name: "Dual Platform Admin + Staff" } });
      await prisma.membership.create({ data: { userId: dualId, organizationId: fixtures.orgA.id, role: "OWNER" } });
      try {
        setMockAuthUser({ id: dualId, email: dualEmail });
        const response = await POST(jsonRequest({ message: "hello" }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "Not authorized." });
      } finally {
        await prisma.membership.deleteMany({ where: { userId: dualId } });
        await prisma.user.delete({ where: { id: dualId } });
      }
    });

    it("ordinary staff -> 200 with the stable {answer} response shape", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const response = await POST(jsonRequest({ message: "hello" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ answer: expect.any(String) });
      expect(Object.keys(body)).toEqual(["answer"]);
    });
  });

  describe("response contract", () => {
    it("returns the fixed, deterministic mock answer — never influenced by the request body", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const response = await POST(jsonRequest({ message: "anything at all, this text has zero effect" }));
      const body = await response.json();
      expect(body.answer).toBe("This is a mock AI Assistant response for automated testing.");
    });

    it("never returns provider/model, usage, tool names, refs, organizationId/userId, system prompt, or correlationId", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const response = await POST(jsonRequest({ message: "hello" }));
      const body = await response.json();
      expect(body).not.toHaveProperty("provider");
      expect(body).not.toHaveProperty("usage");
      expect(body).not.toHaveProperty("toolNames");
      expect(body).not.toHaveProperty("organizationId");
      expect(body).not.toHaveProperty("userId");
      expect(body).not.toHaveProperty("correlationId");
    });

    it("sets Cache-Control: private, no-store on a real 200 response", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const response = await POST(jsonRequest({ message: "hello" }));
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
    });

    it("sets Cache-Control: private, no-store on every error response too", async () => {
      const response = await POST(jsonRequest({ message: "hello" })); // unauthenticated -> 401
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
    });
  });

  describe("body validation", () => {
    beforeEach(() => {
      actAs(fixtures.owner, fixtures.orgA.id);
    });

    it("rejects a malformed (non-JSON) body with a generic 400", async () => {
      const response = await POST(jsonRequest("not valid json"));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request." });
    });

    it("rejects a wrong Content-Type with a generic 400", async () => {
      const response = await POST(jsonRequest({ message: "hello" }, "text/plain"));
      expect(response.status).toBe(400);
    });

    it("rejects an oversized message with a generic 400", async () => {
      const response = await POST(jsonRequest({ message: "a".repeat(2001) }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request." });
    });

    it("rejects an unknown key with a generic 400", async () => {
      const response = await POST(jsonRequest({ message: "hello", organizationId: fixtures.orgB.id }));
      expect(response.status).toBe(400);
    });

    it("rejects an empty/whitespace-only message with a generic 400", async () => {
      const response = await POST(jsonRequest({ message: "    " }));
      expect(response.status).toBe(400);
    });
  });
});
