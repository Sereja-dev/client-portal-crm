import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { suggestNextQuoteNumber } from "@/lib/quotes/suggest-next-quote-number";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 1 — the DB-touching half of the numbering
 * helper (see src/lib/quotes/numbering.ts's own header comment; the pure
 * half is covered in test/unit/quote-numbering.test.ts). Proves the real
 * Prisma query is organization-scoped and produces the same suggestion
 * the pure function would given the same inputs.
 */

const NUMBER_PREFIX = "Q-";

function uniqueQuoteName(): string {
  return `Quote-NumberingTest-${randomUUID().slice(0, 8)}`;
}

describe("suggestNextQuoteNumber (DB-touching)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: "Quote-NumberingTest" } } });
    await cleanupTestData(fixtures);
  });

  it("suggests Q-0001 for an organization with no existing Quotes", async () => {
    const suggestion = await suggestNextQuoteNumber(fixtures.orgA.id);
    expect(suggestion).toBe("Q-0001");
  });

  it("increments from this organization's own highest existing Q-number", async () => {
    await prisma.quote.create({
      data: {
        title: uniqueQuoteName(),
        organizationId: fixtures.orgA.id,
        number: `${NUMBER_PREFIX}0001`,
        clientId: fixtures.clientA.id,
        subtotal: "100.00",
        total: "100.00",
        createdByUserId: fixtures.owner.id,
      },
    });
    await prisma.quote.create({
      data: {
        title: uniqueQuoteName(),
        organizationId: fixtures.orgA.id,
        number: `${NUMBER_PREFIX}0002`,
        clientId: fixtures.clientA.id,
        subtotal: "50.00",
        total: "50.00",
        createdByUserId: fixtures.owner.id,
      },
    });

    const suggestion = await suggestNextQuoteNumber(fixtures.orgA.id);
    expect(suggestion).toBe("Q-0003");
  });

  it("never crosses organizations — a different org's own Q-numbers don't influence this suggestion", async () => {
    await prisma.quote.create({
      data: {
        title: uniqueQuoteName(),
        organizationId: fixtures.orgB.id,
        number: `${NUMBER_PREFIX}0099`,
        clientId: fixtures.clientB.id,
        subtotal: "10.00",
        total: "10.00",
        createdByUserId: fixtures.orgBOwner.id,
      },
    });

    // orgA's own suggestion is unaffected by orgB's much-higher Q-0099.
    const orgASuggestion = await suggestNextQuoteNumber(fixtures.orgA.id);
    expect(orgASuggestion).toBe("Q-0003");

    // orgB's own suggestion correctly reflects its own highest number.
    const orgBSuggestion = await suggestNextQuoteNumber(fixtures.orgB.id);
    expect(orgBSuggestion).toBe("Q-0100");
  });

  it("a manually-entered non-conventional number never breaks the suggestion for this organization", async () => {
    await prisma.quote.create({
      data: {
        title: uniqueQuoteName(),
        organizationId: fixtures.orgA.id,
        number: "REF-ACME-2026",
        clientId: fixtures.clientA.id,
        subtotal: "25.00",
        total: "25.00",
        createdByUserId: fixtures.owner.id,
      },
    });
    // Also Q-prefixed (passes the query's own `startsWith` filter) but not
    // purely digits after the dash — must still be skipped by the pure
    // function's own stricter regex, not just excluded at the SQL layer.
    await prisma.quote.create({
      data: {
        title: uniqueQuoteName(),
        organizationId: fixtures.orgA.id,
        number: "Q-ACME-SPECIAL",
        clientId: fixtures.clientA.id,
        subtotal: "5.00",
        total: "5.00",
        createdByUserId: fixtures.owner.id,
      },
    });

    const suggestion = await suggestNextQuoteNumber(fixtures.orgA.id);
    expect(suggestion).toBe("Q-0003");
  });
});
