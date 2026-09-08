import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteAction, archiveQuoteAction, unarchiveQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — archiveQuoteAction/unarchiveQuoteAction.
 * Covers RETURN FORMAT §T ARCHIVE items 37-40.
 */

const NAME_PREFIX = "Quote-Archive";

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

describe("archiveQuoteAction / unarchiveQuoteAction", () => {
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

  it("37. archives a Quote", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await archiveQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.archivedAt).not.toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { entityType: "QUOTE", entityId: created.quoteId, action: "UPDATED" },
    });
    expect(activity).not.toBeNull();
  });

  it("38. unarchives a Quote", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await archiveQuoteAction(created.quoteId);

    const result = await unarchiveQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.archivedAt).toBeNull();
  });

  it("39. archiving an already-archived Quote is idempotent — no duplicate Activity row", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await archiveQuoteAction(created.quoteId);
    expect(first.ok).toBe(true);
    const second = await archiveQuoteAction(created.quoteId);
    expect(second.ok).toBe(true);

    const activities = await prisma.activity.findMany({
      where: { entityType: "QUOTE", entityId: created.quoteId, action: "UPDATED" },
    });
    expect(activities).toHaveLength(1);
  });

  it("archive/unarchive works regardless of stored status — an APPROVED/converted Quote may still be archived", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const created = await createQuoteAction(baseInput({ clientId: fixtures.clientA.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.quote.update({ where: { id: created.quoteId }, data: { status: "APPROVED", approvedAt: new Date() } });

    const result = await archiveQuoteAction(created.quoteId);
    expect(result.ok).toBe(true);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });
    expect(quote.archivedAt).not.toBeNull();
    expect(quote.status).toBe("APPROVED");
  });

  it("40. a foreign-org Quote id is blocked (not_found)", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const foreignCreated = await createQuoteAction(baseInput({ clientId: fixtures.clientB.id }));
    expect(foreignCreated.ok).toBe(true);
    if (!foreignCreated.ok) return;
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await archiveQuoteAction(foreignCreated.quoteId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");

    resetAuthMock();
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: foreignCreated.quoteId } });
    expect(quote.archivedAt).toBeNull();
  });
});
