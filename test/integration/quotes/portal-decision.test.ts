import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { approvePortalQuoteAction, declinePortalQuoteAction } from "@/app/portal/(app)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 4 (Client Portal approval/decline) §F/§G/§M —
 * approvePortalQuoteAction/declinePortalQuoteAction. Covers RETURN FORMAT
 * §U APPROVE items 16-26, DECLINE items 27-32, RACE items 33-34, and
 * STAFF items 35-38 (verified here at the data level — the e2e suite
 * separately proves the Staff UI itself renders the resulting state).
 */
describe("Portal Quote decisions (§F/§G/§M)", () => {
  let fixtures: TestFixtures;
  const quoteIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);

  async function createQuote(overrides: Record<string, unknown>) {
    const quote = await prisma.quote.create({
      data: {
        number: `PQD-${suffix}-${randomUUID().slice(0, 6)}`,
        status: "DRAFT",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "50.00",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        ...overrides,
      },
    });
    quoteIds.push(quote.id);
    return quote;
  }

  function actAsPortal() {
    setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await cleanupTestData(fixtures);
  });

  describe("approve", () => {
    it("16/17/18. an eligible SENT quote approves: ok, approvedAt set, status APPROVED", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();

      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: true });

      const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(updated.status).toBe("APPROVED");
      expect(updated.approvedAt).not.toBeNull();
    });

    it("36. an approved quote's target/recipient snapshot are untouched, and no Invoice is created", async () => {
      const quote = await createQuote({
        status: "SENT",
        sentAt: new Date(),
        recipientName: "Original Recipient",
        recipientEmail: "original@example.com",
      });
      actAsPortal();

      await approvePortalQuoteAction(quote.id);

      const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(updated.clientId).toBe(fixtures.clientA.id);
      expect(updated.recipientName).toBe("Original Recipient");
      expect(updated.recipientEmail).toBe("original@example.com");
      expect(updated.convertedInvoiceId).toBeNull();
      const invoiceCount = await prisma.invoice.count({ where: { clientId: fixtures.clientA.id, invoiceNumber: { contains: quote.number } } });
      expect(invoiceCount).toBe(0);
    });

    it("19. a second approve on an already-APPROVED quote is blocked (idempotently controlled, not a corrupting double-apply)", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();

      const first = await approvePortalQuoteAction(quote.id);
      expect(first).toEqual({ ok: true });
      const approvedAtAfterFirst = (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).approvedAt;

      const second = await approvePortalQuoteAction(quote.id);
      expect(second).toEqual({ ok: false, reason: "invalid_transition" });

      const finalRow = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(finalRow.approvedAt?.getTime()).toBe(approvedAtAfterFirst?.getTime()); // untouched by the second attempt
    });

    it("20. an expired SENT quote cannot be approved", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date("2020-01-01") });
      actAsPortal();

      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
    });

    it("21. a DRAFT quote cannot be approved (invalid_transition — the action's own ownership scope already matched this Portal Client's own Quote; only its stored status disqualifies it, unlike a foreign Quote's ownership mismatch below, which is not_found)", async () => {
      const quote = await createQuote({ status: "DRAFT" });
      actAsPortal();
      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("DRAFT");
    });

    it("22. a DECLINED quote cannot be approved", async () => {
      const quote = await createQuote({ status: "DECLINED", declinedAt: new Date() });
      actAsPortal();
      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });

    it("23. an APPROVED quote cannot be approved again via a fresh call", async () => {
      const quote = await createQuote({ status: "APPROVED", approvedAt: new Date() });
      actAsPortal();
      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });

    it("24. a converted quote cannot be approved", async () => {
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `PQD-INV-${suffix}`,
          status: "DRAFT",
          amount: "50.00",
          subtotal: "50.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
          issueDate: new Date(),
        },
      });
      const quote = await createQuote({ status: "APPROVED", approvedAt: new Date(), convertedInvoiceId: invoice.id });
      actAsPortal();

      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });

      await prisma.invoice.deleteMany({ where: { id: invoice.id } });
    });

    it("25. a foreign-org quote cannot be approved (not_found, indistinguishable)", async () => {
      const foreignQuote = await prisma.quote.create({
        data: {
          number: `PQD-${suffix}-FOREIGN`,
          status: "SENT",
          sentAt: new Date(),
          subtotal: "1.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "1.00",
          organizationId: fixtures.orgB.id,
          createdByUserId: fixtures.orgBOwner.id,
          clientId: fixtures.clientB.id,
        },
      });
      actAsPortal();

      const result = await approvePortalQuoteAction(foreignQuote.id);
      expect(result).toEqual({ ok: false, reason: "not_found" });

      await prisma.quote.deleteMany({ where: { id: foreignQuote.id } });
    });

    it("26. a cross-client quote in the SAME org cannot be approved (not_found, indistinguishable)", async () => {
      const otherClient = await prisma.client.create({
        data: { name: `PQD Other Client ${suffix}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      const quote = await createQuote({ status: "SENT", sentAt: new Date(), clientId: otherClient.id });
      actAsPortal();

      const result = await approvePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "not_found" });

      // Quote.clientId -> Client is Restrict — delete this test's own
      // Quote before its Client (never rely on afterAll's ordering,
      // which only tracks quoteIds, not this ad-hoc Client).
      await prisma.quote.deleteMany({ where: { id: quote.id } });
      await prisma.client.deleteMany({ where: { id: otherClient.id } });
    });
  });

  describe("decline", () => {
    it("27/28/29. an eligible SENT quote declines: ok, declinedAt set, status DECLINED", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();

      const result = await declinePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: true });

      const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(updated.status).toBe("DECLINED");
      expect(updated.declinedAt).not.toBeNull();
    });

    it("38. a declined quote is never auto-reopened, and its Client/target are untouched", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();
      await declinePortalQuoteAction(quote.id);

      const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(updated.status).toBe("DECLINED"); // never silently back to DRAFT
      expect(updated.clientId).toBe(fixtures.clientA.id);
    });

    it("30. a second decline on an already-DECLINED quote is blocked", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();
      const first = await declinePortalQuoteAction(quote.id);
      expect(first).toEqual({ ok: true });

      const second = await declinePortalQuoteAction(quote.id);
      expect(second).toEqual({ ok: false, reason: "invalid_transition" });
    });

    it("31. an expired SENT quote cannot be declined", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date(), validUntil: new Date("2020-01-01") });
      actAsPortal();
      const result = await declinePortalQuoteAction(quote.id);
      expect(result).toEqual({ ok: false, reason: "invalid_transition" });
    });

    it("32. a foreign quote cannot be declined", async () => {
      const foreignQuote = await prisma.quote.create({
        data: {
          number: `PQD-${suffix}-FOREIGN-DECLINE`,
          status: "SENT",
          sentAt: new Date(),
          subtotal: "1.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "1.00",
          organizationId: fixtures.orgB.id,
          createdByUserId: fixtures.orgBOwner.id,
          clientId: fixtures.clientB.id,
        },
      });
      actAsPortal();
      const result = await declinePortalQuoteAction(foreignQuote.id);
      expect(result).toEqual({ ok: false, reason: "not_found" });
      await prisma.quote.deleteMany({ where: { id: foreignQuote.id } });
    });
  });

  describe("race safety", () => {
    it("33. concurrent approve + decline on the same SENT quote: exactly one wins, the Quote ends in exactly one valid terminal state", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();

      const [approveResult, declineResult] = await Promise.all([
        approvePortalQuoteAction(quote.id),
        declinePortalQuoteAction(quote.id),
      ]);

      const results = [approveResult, declineResult];
      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);

      const final = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(["APPROVED", "DECLINED"]).toContain(final.status);
      // The final stored status matches whichever action actually won.
      if (approveResult.ok) {
        expect(final.status).toBe("APPROVED");
        expect(final.approvedAt).not.toBeNull();
      } else {
        expect(final.status).toBe("DECLINED");
        expect(final.declinedAt).not.toBeNull();
      }
    });

    it("34. repeated concurrent approve calls never corrupt state — exactly one succeeds", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();

      const results = await Promise.all([
        approvePortalQuoteAction(quote.id),
        approvePortalQuoteAction(quote.id),
        approvePortalQuoteAction(quote.id),
        approvePortalQuoteAction(quote.id),
        approvePortalQuoteAction(quote.id),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const final = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(final.status).toBe("APPROVED");
    });
  });

  describe("staff-visible effect (§N)", () => {
    it("35/36. after Portal approve, the raw Quote row (the Staff page's own data source) shows APPROVED with clientId still present, eligible for Convert", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();
      await approvePortalQuoteAction(quote.id);

      const staffView = await prisma.quote.findFirst({ where: { id: quote.id, organizationId: fixtures.orgA.id } });
      expect(staffView?.status).toBe("APPROVED");
      expect(staffView?.clientId).toBe(fixtures.clientA.id); // Staff's own canConvert check requires this
      expect(staffView?.archivedAt).toBeNull();
    });

    it("37/38. after Portal decline, the raw Quote row shows DECLINED, eligible for Staff Reopen", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();
      await declinePortalQuoteAction(quote.id);

      const staffView = await prisma.quote.findFirst({ where: { id: quote.id, organizationId: fixtures.orgA.id } });
      expect(staffView?.status).toBe("DECLINED"); // Staff's own canReopen check requires exactly this
      expect(staffView?.convertedInvoiceId).toBeNull();
    });

    it("an Activity row is recorded for the decision, with a null actorId and the Portal user's own name in metadata", async () => {
      const quote = await createQuote({ status: "SENT", sentAt: new Date() });
      actAsPortal();
      await approvePortalQuoteAction(quote.id);

      const activity = await prisma.activity.findFirst({
        where: { entityType: "QUOTE", entityId: quote.id, action: "STATUS_CHANGED" },
        orderBy: { createdAt: "desc" },
      });
      expect(activity).not.toBeNull();
      expect(activity?.actorId).toBeNull();
      expect(activity?.metadata).toMatchObject({ from: "SENT", to: "APPROVED", actorName: fixtures.portalUser.name });
    });
  });
});
