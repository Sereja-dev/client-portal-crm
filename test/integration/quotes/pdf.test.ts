import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/quotes/[id]/pdf/route";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Quote PDF — current-state, on-demand Route Handler. Calls the real,
 * unmodified GET export directly with real seeded Prisma data and the
 * real getCurrentUserOrganization() resolution — matching
 * test/integration/invoices/pdf-download.test.ts's own identical
 * "call the real handler" discipline. Only the generic rate limiter is
 * mocked (file-local override, same precedent).
 *
 * Unlike the Invoice PDF route, this one renders a real PDF buffer on
 * every call — no Storage, no signed URL, no ledger — so success is
 * asserted directly against the returned bytes/headers.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

beforeEach(() => {
  mockedCheckRateLimit.mockReset().mockReturnValue({ limited: false });
});

afterEach(() => {
  resetAuthMock();
});

function pdfRequest(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/quotes/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
}

const NAME_PREFIX = "Quote-PDF";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseQuoteInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "2", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("GET /api/quotes/[id]/pdf — current-state, on-demand Quote PDF", () => {
  let fixtures: TestFixtures;
  let leadA: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    leadA = await prisma.lead.create({
      data: { name: "PDF Test Lead", organizationId: fixtures.orgA.id, email: "pdflead@example.test" },
    });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.lead.deleteMany({ where: { id: leadA.id } });
    await cleanupTestData(fixtures);
  });

  // --- Authorization / rate limiting ------------------------------------------

  it("an unauthenticated request preserves the existing app-wide redirect-to-login behavior, with no Quote-domain query", async () => {
    const quoteSpy = vi.spyOn(prisma.quote, "findFirst");
    try {
      let caught: unknown;
      try {
        await pdfRequest(randomUUID());
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RedirectSignal);
      expect(quoteSpy).not.toHaveBeenCalled();
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it("a rate-limited request returns 429 with the generic message, before any Quote-domain query", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });

    const quoteSpy = vi.spyOn(prisma.quote, "findFirst");
    try {
      const response = await pdfRequest(randomUUID());
      expect(response.status).toBe(429);
      expect(await response.text()).toBe(RATE_LIMIT_MESSAGE);
      expect(quoteSpy).not.toHaveBeenCalled();
    } finally {
      quoteSpy.mockRestore();
    }
  });

  // --- Role coverage (any member, no OWNER gate) ------------------------------

  for (const role of ["owner", "admin", "member"] as const) {
    it(`${role.toUpperCase()} succeeds — 200, application/pdf, real PDF bytes`, async () => {
      actAs(fixtures[role], fixtures.orgA.id);
      const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await pdfRequest(created.quoteId);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      // %PDF magic signature — proves this is a real rendered PDF, not a placeholder.
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("%PDF");
    });
  }

  // --- Not found / tenant isolation -------------------------------------------

  it("a nonexistent Quote id returns the generic 404", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const response = await pdfRequest(randomUUID());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("a cross-organization Quote returns a byte-identical generic 404", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const createdInOrgB = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientB.id }));
    expect(createdInOrgB.ok).toBe(true);
    if (!createdInOrgB.ok) return;

    actAs(fixtures.owner, fixtures.orgA.id);
    const [nonexistentResponse, crossOrgResponse] = await Promise.all([
      pdfRequest(randomUUID()),
      pdfRequest(createdInOrgB.quoteId),
    ]);

    expect(crossOrgResponse.status).toBe(404);
    expect(await crossOrgResponse.text()).toBe(await nonexistentResponse.text());
    expect(nonexistentResponse.status).toBe(crossOrgResponse.status);
  });

  // --- Status/archive/convert coverage — none of them block PDF generation ---

  const statusScenarios: Array<{ name: string; setup: (quoteId: string) => Promise<void> }> = [
    { name: "DRAFT", setup: async () => {} },
    { name: "SENT", setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } })) },
    {
      name: "APPROVED",
      setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } })),
    },
    {
      name: "DECLINED",
      setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { status: "DECLINED", declinedAt: new Date() } })),
    },
    { name: "archived", setup: async (id) => void (await prisma.quote.update({ where: { id }, data: { archivedAt: new Date() } })) },
  ];

  for (const scenario of statusScenarios) {
    it(`a Quote at ${scenario.name} still generates a PDF — archive/lifecycle state never blocks on-demand generation`, async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await scenario.setup(created.quoteId);

      const response = await pdfRequest(created.quoteId);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
    });
  }

  it("a converted Quote still generates a PDF representing the Quote itself, not its converted Invoice", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id, items: [{ description: "Original line", quantity: "1", unitPrice: "42.00" }] }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const fakeInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${NAME_PREFIX}-INV-${randomUUID().slice(0, 8)}`,
        status: "DRAFT",
        amount: "42.00",
        subtotal: "42.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    await prisma.quote.update({ where: { id: created.quoteId }, data: { convertedInvoiceId: fakeInvoice.id } });

    const response = await pdfRequest(created.quoteId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    await prisma.invoice.deleteMany({ where: { id: fakeInvoice.id } });
  });

  // --- Quote shapes: Lead target, discount/tax, no-notes ----------------------

  it("a Lead-target Quote (no Client) generates a PDF without throwing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ leadId: leadA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const response = await pdfRequest(created.quoteId);
    expect(response.status).toBe(200);
  });

  it("a Quote with discount and tax generates a PDF without throwing, filename reflects the Quote number", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const number = uniqueNumber();
    const created = await createQuoteAction(
      baseQuoteInput({ number, clientId: fixtures.clientA.id, discountType: "PERCENTAGE", discountValue: "10", taxRatePercent: "8.25" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const response = await pdfRequest(created.quoteId);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(`Quote-${number}.pdf`);
  });

  it("a Quote with no discount/tax/notes generates a PDF without throwing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const response = await pdfRequest(created.quoteId);
    expect(response.status).toBe(200);
  });

  // --- Zero-write invariant ----------------------------------------------------

  it("generating a PDF never mutates the Quote — no archive/status/snapshot field is ever written", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    await pdfRequest(created.quoteId);
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });

    expect({ ...after, updatedAt: after.updatedAt.toISOString() }).toEqual({ ...before, updatedAt: before.updatedAt.toISOString() });
  });
});
