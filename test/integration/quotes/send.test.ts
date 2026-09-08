import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction, sendQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — sendQuoteAction. Covers RETURN FORMAT §T
 * SEND items 24-31. "Send" here is purely the lifecycle transition to
 * SENT — no Resend call, no PDF, matching this phase's own explicit scope.
 */

const NAME_PREFIX = "Quote-Send";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("sendQuoteAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  it("24 & 25. DRAFT -> SENT, and sentAt is set", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = Date.now();
    const result = await sendQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("SENT");
    expect(quote.sentAt).not.toBeNull();
    expect(quote.sentAt!.getTime()).toBeGreaterThanOrEqual(before);

    const activity = await prisma.activity.findFirst({
      where: { entityType: "QUOTE", entityId: created.quoteId, action: "STATUS_CHANGED" },
    });
    expect(activity?.metadata).toMatchObject({ from: "DRAFT", to: "SENT" });
  });

  it("26. the recipient snapshot is derived from the Client when clientId is set", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const client = await prisma.client.create({
      data: {
        name: `${NAME_PREFIX}-Client`,
        email: "client-recipient@example.com",
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    try {
      const created = await createQuoteAction(baseInput({ clientId: client.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await sendQuoteAction(created.quoteId);
      expect(result.ok).toBe(true);

      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
      expect(quote.recipientName).toBe(client.name);
      expect(quote.recipientEmail).toBe("client-recipient@example.com");
    } finally {
      await prisma.quote.deleteMany({ where: { clientId: client.id } });
      await prisma.client.deleteMany({ where: { id: client.id } });
    }
  });

  it("27. the recipient snapshot is derived from the Lead when only leadId is set", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const lead = await prisma.lead.create({
      data: { name: `${NAME_PREFIX}-Lead`, email: "lead-recipient@example.com", organizationId: fixtures.orgA.id },
    });
    try {
      const created = await createQuoteAction(baseInput({ leadId: lead.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await sendQuoteAction(created.quoteId);
      expect(result.ok).toBe(true);

      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
      expect(quote.recipientName).toBe(lead.name);
      expect(quote.recipientEmail).toBe("lead-recipient@example.com");
    } finally {
      await prisma.quote.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
    }
  });

  it("28. sendQuoteAction takes no recipient input at all — a caller can never influence the snapshot", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const client = await prisma.client.create({
      data: {
        name: `${NAME_PREFIX}-Real-Client`,
        email: "real@example.com",
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    try {
      const created = await createQuoteAction(baseInput({ clientId: client.id }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // sendQuoteAction's own signature is (quoteId: string) — there is no
      // parameter position for a recipient override at all, so this call
      // (identical to every other call site) is the strongest possible
      // proof: whatever it derives always comes from the live Client row.
      await sendQuoteAction(created.quoteId);
      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
      expect(quote.recipientEmail).toBe("real@example.com");
    } finally {
      await prisma.quote.deleteMany({ where: { clientId: client.id } });
      await prisma.client.deleteMany({ where: { id: client.id } });
    }
  });

  it("29. a Quote whose validUntil has already passed is rejected", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    // issueDate must be <= validUntil (this action's own cross-field
    // validation) — both set in the past relative to "now" so validUntil
    // is genuinely expired, not merely earlier than issueDate.
    const created = await createQuoteAction(
      baseInput({ clientId: fixtures.clientA.id, issueDate: "2019-01-01", validUntil: "2020-01-01" }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await sendQuoteAction(created.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_transition");

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.status).toBe("DRAFT");
  });

  it("a Quote with a future validUntil sends normally", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id, validUntil: "2099-01-01" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await sendQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);
  });

  it("30. a non-DRAFT Quote cannot be sent", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const firstSend = await sendQuoteAction(created.quoteId);
    expect(firstSend.ok).toBe(true);

    const secondSend = await sendQuoteAction(created.quoteId);
    expect(secondSend.ok).toBe(false);
    if (secondSend.ok) return;
    expect(secondSend.reason).toBe("invalid_transition");
  });

  it("31. an archived Quote cannot be sent", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { archivedAt: new Date() } });

    const result = await sendQuoteAction(created.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_transition");
  });

  it("a not-found quoteId (foreign org) is rejected", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const foreignCreated = await createQuoteAction(baseInput({ clientId: fixtures.clientB.id }));
    expect(foreignCreated.ok).toBe(true);
    if (!foreignCreated.ok) return;
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await sendQuoteAction(foreignCreated.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });
});
