import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createRecurringInvoice, type RecurringInvoiceActor } from "@/lib/recurring-invoices/recurring-invoices";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

// Same reasoning as test/integration/cron/routes.test.ts — src/lib/cron/auth.ts
// imports the real "server-only" marker package, which throws outside
// Next's own "react-server" resolve condition.
vi.mock("server-only", () => ({}));

const { GET: recurringInvoicesGet } = await import("@/app/api/cron/recurring-invoices/route");

/**
 * Recurring Invoices Phase 2B-1 — the new cron route (test items 26-31).
 * Mirrors test/integration/cron/routes.test.ts's own exact pattern (real
 * requireCronAuth, real Route Handler, TEST_CRON_SECRET override).
 *
 * IMPORTANT: this route is NOT registered in vercel.json in this phase —
 * these tests only prove the route itself is correct and safely
 * authenticated; they say nothing about scheduling, which remains a
 * separate, deliberate follow-up.
 */

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const TEST_CRON_SECRET = "integration-test-cron-secret";

function cronRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers: new Headers(headers) });
}

function actorFor(user: { id: string; name: string }): RecurringInvoiceActor {
  return { id: user.id, name: user.name, role: "OWNER" };
}

function pastDateOnly(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function cleanupAll(organizationIds: string[]) {
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.recurringInvoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

afterAll(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

describe("cron route — /api/cron/recurring-invoices (real requireCronAuth + real Route Handler)", () => {
  beforeAll(() => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  it("26. rejects a request with no Authorization header (401)", async () => {
    const response = await recurringInvoicesGet(cronRequest("/api/cron/recurring-invoices"));
    expect(response.status).toBe(401);
  });

  it("27. rejects the wrong secret (401)", async () => {
    const response = await recurringInvoicesGet(cronRequest("/api/cron/recurring-invoices", { authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
  });

  it("28. accepts the correct bearer secret (200)", async () => {
    const response = await recurringInvoicesGet(
      cronRequest("/api/cron/recurring-invoices", { authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(response.status).toBe(200);
  });

  it("30. returns only the aggregate summary keys — no schedule ID, client name, invoice number, or note", async () => {
    const response = await recurringInvoicesGet(
      cronRequest("/api/cron/recurring-invoices", { authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["errored", "failed", "generated", "scanned", "skipped"]);
    for (const value of Object.values(body)) {
      expect(typeof value).toBe("number");
    }
  });

  it("29. requireCronAuth runs before checkRateLimit, using the fixed 'recurring-invoices' bucket key — checkRateLimit itself is globally stubbed to always allow in this integration harness (see test/integration/setup-mocks.ts), so ordering/bucket-key correctness is proven at the source level here rather than by actually tripping a 429", () => {
    const source = readFileSync("src/app/api/cron/recurring-invoices/route.ts", "utf8");
    const authIndex = source.indexOf("requireCronAuth(");
    const rateLimitIndex = source.indexOf("checkRateLimit(");
    expect(authIndex).toBeGreaterThan(-1);
    expect(rateLimitIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(rateLimitIndex);
    expect(source).toContain('checkRateLimit(CRON_JOB_LIMIT, "recurring-invoices")');
  });

  it("with CRON_SECRET unset (simulating a misconfigured deployment), safely rejects even a plausible-looking bearer value", async () => {
    delete process.env.CRON_SECRET;
    const response = await recurringInvoicesGet(cronRequest("/api/cron/recurring-invoices", { authorization: "Bearer anything" }));
    expect(response.status).toBe(401);
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  it("a staff session cookie is never a substitute for the bearer secret — the route never reads cookies", async () => {
    const response = await recurringInvoicesGet(cronRequest("/api/cron/recurring-invoices", { cookie: "active_organization_id=whatever" }));
    expect(response.status).toBe(401);
  });
});

describe("cron route — real batch behavior", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  afterEach(async () => {
    await cleanupAll([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("31. a completed batch with a failed/errored schedule still returns 200, never a non-200", async () => {
    const created = await createRecurringInvoice(fixtures.orgA.id, actorFor(fixtures.owner), {
      clientId: fixtures.clientA.id,
      frequency: "MONTHLY",
      firstIssueDate: pastDateOnly(1),
      invoiceNumberPrefix: "ROUTE-BROKEN-",
      currency: "USD",
      lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "100.00" }],
    });
    if (!created.ok) throw new Error("expected ok");
    // Deliberately corrupt the line item so generation throws for this schedule.
    await prisma.recurringInvoiceLineItem.updateMany({ where: { recurringInvoiceId: created.recurringInvoice.id }, data: { quantity: "0" } });

    const response = await recurringInvoicesGet(
      cronRequest("/api/cron/recurring-invoices", { authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.errored).toBeGreaterThanOrEqual(1);
  });
});
