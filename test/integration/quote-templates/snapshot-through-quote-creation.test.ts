import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuoteTemplate, updateQuoteTemplate } from "@/lib/quote-templates/service";
import { getQuoteTemplateDefaults } from "@/lib/quote-templates/apply";
import { createQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { actorFor, templateInput } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

/**
 * Quote Templates Phase 2, Section J (the V1 invariant proven end to
 * end, not just at the apply.ts unit level): Template A -> "Start a
 * Quote from it" (getQuoteTemplateDefaults, the exact function the
 * future /quotes/new?template=<id> route calls) -> an ORDINARY,
 * unmodified createQuoteAction call (the exact same action a hand-typed
 * Quote uses) -> a real, persisted Quote row. Editing Template A
 * afterward must leave that already-created Quote completely untouched
 * — proving there is no hidden Template -> Quote relationship, not merely
 * that apply.ts's own returned object happens to be a disconnected copy
 * (already proven at the unit level in apply.test.ts's own "snapshot
 * semantics" describe block).
 *
 * Quote.organizationId is onDelete: Restrict (unlike QuoteTemplate's own
 * Cascade — see Quote's own schema comment, matching create.test.ts's
 * own identical convention), so this test explicitly deletes its own
 * Quote row before cleanupTestData() removes the fixture Organization/
 * Client/User rows it references.
 */
describe("Quote Templates -> Quote snapshot, proven through the real create path", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];
  let quoteIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (quoteIds.length > 0) {
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      quoteIds = [];
    }
    if (templateIds.length > 0) {
      await prisma.quoteTemplate.deleteMany({ where: { id: { in: templateIds } } });
      templateIds = [];
    }
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("editing the template after a Quote was created from it never changes that Quote's already-persisted values", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    const created = await createQuoteTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Template A",
        title: "Original proposal title",
        notes: "Original notes",
        currency: "EUR",
        discountType: "PERCENTAGE",
        discountValue: "15",
        taxRatePercent: "19",
        taxLabel: "VAT",
        validityDays: "30",
        items: [
          { description: "Original item A", quantity: "1", unitPrice: "100.00" },
          { description: "Original item B", quantity: "2", unitPrice: "50.00" },
        ],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    // "Start a quote from it" — the exact same, real, read-only apply
    // entry point the future /quotes/new?template=<id> route calls.
    actAs(fixtures.owner, fixtures.orgA.id);
    const applyResult = await getQuoteTemplateDefaults(created.template.id, NOW);
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const snapshot = applyResult.defaults;

    // An ordinary, completely unmodified Quote-create call — the same
    // action a hand-typed Quote uses, fed with the snapshot's own values
    // plus the ordinary target/number/issueDate every Quote needs.
    const quoteNumber = `SNAPSHOT-${randomUUID().slice(0, 8)}`;
    const createQuoteResult = await createQuoteAction({
      number: quoteNumber,
      title: snapshot.title ?? undefined,
      clientId: fixtures.clientA.id,
      issueDate: "2026-06-15",
      validUntil: snapshot.validUntil ?? undefined,
      currency: snapshot.currency,
      notes: snapshot.notes ?? undefined,
      discountType: snapshot.discountType,
      discountValue: snapshot.discountValue ?? undefined,
      taxRatePercent: snapshot.taxRatePercent ?? undefined,
      taxLabel: snapshot.taxLabel,
      items: snapshot.items,
    });
    expect(createQuoteResult.ok).toBe(true);
    if (!createQuoteResult.ok) return;
    quoteIds.push(createQuoteResult.quoteId);

    const originalQuote = await prisma.quote.findUniqueOrThrow({
      where: { id: createQuoteResult.quoteId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    expect(originalQuote.title).toBe("Original proposal title");
    expect(originalQuote.notes).toBe("Original notes");
    expect(originalQuote.currency).toBe("EUR");
    expect(originalQuote.discountType).toBe("PERCENTAGE");
    expect(originalQuote.discountValue?.toString()).toBe("15");
    expect(originalQuote.taxRatePercent?.toString()).toBe("19");
    expect(originalQuote.taxLabel).toBe("VAT");
    expect(originalQuote.validUntil?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(originalQuote.items.map((i) => i.description)).toEqual(["Original item A", "Original item B"]);

    // Now edit Template A to completely different content.
    const updated = await updateQuoteTemplate(
      fixtures.orgA.id,
      created.template.id,
      owner,
      templateInput({
        name: "Template A (changed)",
        title: "CHANGED title",
        notes: "CHANGED notes",
        currency: "USD",
        discountType: "FIXED",
        discountValue: "5.00",
        taxRatePercent: "0",
        taxLabel: "GST",
        validityDays: "7",
        items: [{ description: "CHANGED item", quantity: "9", unitPrice: "9.00" }],
      }),
    );
    expect(updated.ok).toBe(true);

    // The already-created Quote is completely untouched — same row,
    // re-fetched fresh from the database, every field identical to what
    // was asserted above. This is the whole point: there is no
    // persistent Template -> Quote relationship of any kind (the Quote
    // model itself has no quoteTemplateId column at all — this line
    // would fail to compile, not merely fail an assertion, if one were
    // ever added and this test tried to use it) for an edit to
    // propagate through even if the domain layer wanted it to.
    const quoteAfterTemplateEdit = await prisma.quote.findUniqueOrThrow({
      where: { id: createQuoteResult.quoteId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    expect(quoteAfterTemplateEdit.title).toBe("Original proposal title");
    expect(quoteAfterTemplateEdit.notes).toBe("Original notes");
    expect(quoteAfterTemplateEdit.currency).toBe("EUR");
    expect(quoteAfterTemplateEdit.discountType).toBe("PERCENTAGE");
    expect(quoteAfterTemplateEdit.discountValue?.toString()).toBe("15");
    expect(quoteAfterTemplateEdit.taxRatePercent?.toString()).toBe("19");
    expect(quoteAfterTemplateEdit.taxLabel).toBe("VAT");
    expect(quoteAfterTemplateEdit.items.map((i) => i.description)).toEqual(["Original item A", "Original item B"]);
    expect(quoteAfterTemplateEdit.updatedAt.getTime()).toBe(originalQuote.updatedAt.getTime());
  });
});
