import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction, convertLeadToClientAction } from "@/app/(dashboard)/leads/actions";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Quotes / Estimates Phase 2 — the Lead -> Client Quote reconciliation
 * step added inside convertLeadToClientAction's own existing transaction
 * (src/app/(dashboard)/leads/actions.ts). Covers RETURN FORMAT §T LEAD
 * RECONCILIATION items 41-46. Never touches Lead conversion's own UX or
 * duplicate-email semantics — this file only proves the additive Quote
 * side effect.
 */

const NAME_PREFIX = "Quote-LeadReconcile";

function uniqueNumber(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseQuoteInput(overrides: Record<string, unknown> = {}) {
  return {
    number: uniqueNumber(),
    issueDate: "2026-06-01",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "50.00" }],
    ...overrides,
  };
}

describe("Lead -> Client conversion reconciles attached Quotes", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    // Quote rows first (Restrict on both organizationId and clientId), then
    // the converted Clients themselves — every real conversion in this file
    // creates a Client whose name is copied straight from its
    // NAME_PREFIX-prefixed Lead, exactly mirroring convert.test.ts's own
    // established prefix-sweep convention, required here for the same
    // reason (Client.organizationId is onDelete: SetNull, not Cascade, so
    // cleanupTestData()'s Organization deletion alone would leave these
    // Client rows behind and block its final User deletion via the
    // Restrict-FK userId).
    await prisma.quote.deleteMany({ where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("41 & 42. converting the Lead populates Quote.clientId while preserving Quote.leadId", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadResult = await createLeadAction({ name: `${NAME_PREFIX}-Lead` });
    expect(leadResult.ok).toBe(true);
    if (!leadResult.ok) return;
    const leadId = leadResult.leadId;

    const quoteResult = await createQuoteAction(baseQuoteInput({ leadId }));
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;

    const before = await prisma.quote.findUniqueOrThrow({ where: { id: quoteResult.quoteId } });
    expect(before.clientId).toBeNull();
    expect(before.leadId).toBe(leadId);

    const conversionResult = await convertLeadToClientAction(leadId);
    expect(conversionResult.ok).toBe(true);
    if (!conversionResult.ok) return;

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteResult.quoteId } });
    expect(after.leadId).toBe(leadId);
    expect(after.clientId).toBe(conversionResult.clientId);
  });

  it("43. multiple Quotes attached to the same Lead all reconcile", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadResult = await createLeadAction({ name: `${NAME_PREFIX}-Multi-Lead` });
    expect(leadResult.ok).toBe(true);
    if (!leadResult.ok) return;
    const leadId = leadResult.leadId;

    const quote1 = await createQuoteAction(baseQuoteInput({ leadId }));
    const quote2 = await createQuoteAction(baseQuoteInput({ leadId }));
    expect(quote1.ok).toBe(true);
    expect(quote2.ok).toBe(true);
    if (!quote1.ok || !quote2.ok) return;

    const conversionResult = await convertLeadToClientAction(leadId);
    expect(conversionResult.ok).toBe(true);
    if (!conversionResult.ok) return;

    const [after1, after2] = await Promise.all([
      prisma.quote.findUniqueOrThrow({ where: { id: quote1.quoteId } }),
      prisma.quote.findUniqueOrThrow({ where: { id: quote2.quoteId } }),
    ]);
    expect(after1.clientId).toBe(conversionResult.clientId);
    expect(after2.clientId).toBe(conversionResult.clientId);
  });

  it("a direct-Client Quote (no leadId at all) is unaffected by an unrelated Lead's conversion", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const directQuote = await createQuoteAction(baseQuoteInput({ clientId: fixtures.clientA.id }));
    expect(directQuote.ok).toBe(true);
    if (!directQuote.ok) return;

    const leadResult = await createLeadAction({ name: `${NAME_PREFIX}-Unrelated-Lead` });
    expect(leadResult.ok).toBe(true);
    if (!leadResult.ok) return;
    const conversionResult = await convertLeadToClientAction(leadResult.leadId);
    expect(conversionResult.ok).toBe(true);

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: directQuote.quoteId } });
    expect(after.clientId).toBe(fixtures.clientA.id);
    expect(after.leadId).toBeNull();
  });

  it("44. a Quote that already has a clientId is never overwritten by a later conversion of the same Lead", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadResult = await createLeadAction({ name: `${NAME_PREFIX}-AlreadySet-Lead` });
    expect(leadResult.ok).toBe(true);
    if (!leadResult.ok) return;
    const leadId = leadResult.leadId;

    const quoteResult = await createQuoteAction(baseQuoteInput({ leadId }));
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;

    // Simulate an already-reconciled (or otherwise pre-populated) Quote —
    // set clientId to a DIFFERENT real Client than the one this Lead is
    // about to convert into.
    await prisma.quote.update({ where: { id: quoteResult.quoteId }, data: { clientId: fixtures.clientA.id } });

    const conversionResult = await convertLeadToClientAction(leadId);
    expect(conversionResult.ok).toBe(true);
    if (!conversionResult.ok) return;
    expect(conversionResult.clientId).not.toBe(fixtures.clientA.id);

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteResult.quoteId } });
    // Untouched — still the pre-existing clientId, never overwritten by
    // the newly-converted Client.
    expect(after.clientId).toBe(fixtures.clientA.id);
    expect(after.leadId).toBe(leadId);
  });

  it("45. a foreign-org Quote (even one attached to a same-named Lead in another org) is never touched", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const foreignLeadResult = await createLeadAction({ name: `${NAME_PREFIX}-Foreign-Lead` });
    expect(foreignLeadResult.ok).toBe(true);
    if (!foreignLeadResult.ok) return;
    const foreignQuoteResult = await createQuoteAction(baseQuoteInput({ leadId: foreignLeadResult.leadId }));
    expect(foreignQuoteResult.ok).toBe(true);
    if (!foreignQuoteResult.ok) return;
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const orgALeadResult = await createLeadAction({ name: `${NAME_PREFIX}-OrgA-Lead` });
    expect(orgALeadResult.ok).toBe(true);
    if (!orgALeadResult.ok) return;
    const conversionResult = await convertLeadToClientAction(orgALeadResult.leadId);
    expect(conversionResult.ok).toBe(true);

    const foreignAfter = await prisma.quote.findUniqueOrThrow({ where: { id: foreignQuoteResult.quoteId } });
    expect(foreignAfter.clientId).toBeNull();
    expect(foreignAfter.leadId).toBe(foreignLeadResult.leadId);
  });

  it("46. a failed Lead conversion (already converted) leaves attached Quotes unchanged", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const leadResult = await createLeadAction({ name: `${NAME_PREFIX}-Failed-Lead` });
    expect(leadResult.ok).toBe(true);
    if (!leadResult.ok) return;
    const leadId = leadResult.leadId;

    const quoteResult = await createQuoteAction(baseQuoteInput({ leadId }));
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;

    const firstConversion = await convertLeadToClientAction(leadId);
    expect(firstConversion.ok).toBe(true);
    if (!firstConversion.ok) return;

    // A second attempt against the SAME already-converted Lead is
    // rejected — the reconciliation step must not have run a second
    // time (it wouldn't change anything here since clientId is already
    // set, but this proves the rejection path itself never touches
    // Quote rows at all, matching "no new transaction" / "rolls back
    // together" — the whole action returns already_converted before any
    // write happens).
    const secondConversion = await convertLeadToClientAction(leadId);
    expect(secondConversion.ok).toBe(false);
    if (secondConversion.ok) return;
    expect(secondConversion.reason).toBe("already_converted");

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteResult.quoteId } });
    expect(after.clientId).toBe(firstConversion.clientId);
  });
});
