import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveReportsCurrency } from "@/lib/reports/currency";
import { formatLeadValue } from "@/lib/leads/format-value";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Lead Value Currency Correctness fix — real-DB proof that the two-step
 * chain every render call site actually performs (resolveReportsCurrency
 * → formatLeadValue) produces the correct result for a genuinely
 * isolated organization, mirroring
 * test/integration/dashboard/currency-isolation.test.ts's own established
 * "fresh, isolated organization, never shared fixtures" technique exactly
 * — resolveReportsCurrency itself is already exhaustively tested
 * elsewhere (Dashboard/Reports); this file's own job is only to prove
 * Leads' own new call to it, and the formatter it feeds, compose
 * correctly end to end. Deliberately does NOT attempt to render
 * leads/page.tsx or LeadPipelineCard directly — this repo has no DOM/
 * component-interaction harness for an async Server Component, and
 * LeadPipelineCard's own useRouter()/useToast() hooks make it
 * impractical to render via renderToStaticMarkup outside a real Next.js
 * runtime (see test/unit/recurring-invoices/render.test.tsx's own
 * identical, already-documented limitation) — the currency-formatting
 * DECISION itself is what matters, and every one of the three real
 * render call sites is now a direct, unmodified call into these same two
 * functions.
 */
describe("Lead value currency resolution — real DB (Lead Value Currency Correctness fix)", () => {
  type OrgContext = { ownerId: string; organization: { id: string }; client: { id: string } };

  async function makeOrg(label: string): Promise<OrgContext> {
    const ownerId = randomUUID();
    await prisma.user.create({
      data: { id: ownerId, email: testEmail(label, "test.local"), name: `${label} Owner` },
    });
    const organization = await prisma.organization.create({
      data: { name: `${label} Org`, slug: testSlug(label) },
    });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });
    const client = await prisma.client.create({
      data: { organizationId: organization.id, userId: ownerId, name: `${label} Client`, status: "ACTIVE" },
    });
    return { ownerId, organization, client };
  }

  async function cleanupOrg(ctx: OrgContext): Promise<void> {
    await prisma.lead.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.client.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: ctx.organization.id } });
    await prisma.organization.deleteMany({ where: { id: ctx.organization.id } });
    await prisma.user.deleteMany({ where: { id: ctx.ownerId } });
  }

  const contexts: OrgContext[] = [];

  afterAll(async () => {
    for (const ctx of contexts) {
      await cleanupOrg(ctx);
    }
  });

  it("a EUR-only organization: a Lead's value resolves and formats in EUR, never $", async () => {
    const ctx = await makeOrg("lead-curr-eur");
    contexts.push(ctx);

    await prisma.invoice.create({
      data: {
        organizationId: ctx.organization.id,
        clientId: ctx.client.id,
        invoiceNumber: "EUR-SENT-1",
        status: "SENT",
        amount: "50.00",
        currency: "EUR",
        issueDate: new Date(),
      },
    });
    const lead = await prisma.lead.create({
      data: { organizationId: ctx.organization.id, name: "EUR Lead", value: "1234.56" },
    });

    const { selectedCurrency } = await resolveReportsCurrency(ctx.organization.id, undefined);
    expect(selectedCurrency).toBe("EUR");

    const formatted = formatLeadValue(lead.value, selectedCurrency);
    expect(formatted).not.toContain("$");
    expect(formatted).toContain("1,234.56");
  });

  it("a USD-only organization: a Lead's value resolves and formats in USD (regression — existing behavior unchanged)", async () => {
    const ctx = await makeOrg("lead-curr-usd");
    contexts.push(ctx);

    await prisma.invoice.create({
      data: {
        organizationId: ctx.organization.id,
        clientId: ctx.client.id,
        invoiceNumber: "USD-SENT-1",
        status: "SENT",
        amount: "50.00",
        currency: "USD",
        issueDate: new Date(),
      },
    });
    const lead = await prisma.lead.create({
      data: { organizationId: ctx.organization.id, name: "USD Lead", value: "1234.56" },
    });

    const { selectedCurrency } = await resolveReportsCurrency(ctx.organization.id, undefined);
    expect(selectedCurrency).toBe("USD");
    expect(formatLeadValue(lead.value, selectedCurrency)).toBe("$1,234.56");
  });

  it("a brand-new organization with zero invoices and no configured currency: resolution still returns a real currency (documents the resolver's own actual, already-established contract — Leads never invents a currency it didn't get from this resolver)", async () => {
    const ctx = await makeOrg("lead-curr-empty");
    contexts.push(ctx);

    const lead = await prisma.lead.create({
      data: { organizationId: ctx.organization.id, name: "No-Currency-Data Lead", value: "1234.56" },
    });

    const { selectedCurrency, availableCurrencies } = await resolveReportsCurrency(ctx.organization.id, undefined);
    expect(availableCurrencies).toEqual([]);
    // resolveReportsCurrency's own documented contract (src/lib/reports/currency.ts):
    // a real currency is still returned (never true `null`) even with zero
    // invoices — this is the resolver's own existing, already-tested
    // behavior, not something this fix changes. formatLeadValue still
    // formats correctly against whatever it returns.
    expect(typeof selectedCurrency).toBe("string");
    const formatted = formatLeadValue(lead.value, selectedCurrency);
    expect(formatted).toContain("1,234.56");
  });

  it("CRITICAL — formatLeadValue itself never invents USD when handed a null currency directly (the actual fallback contract this fix exists to guarantee)", async () => {
    const ctx = await makeOrg("lead-curr-null-direct");
    contexts.push(ctx);

    const lead = await prisma.lead.create({
      data: { organizationId: ctx.organization.id, name: "Direct Null Lead", value: "1234.56" },
    });

    const formatted = formatLeadValue(lead.value, null);
    expect(formatted).toBe("—");
    expect(formatted).not.toContain("$");
  });
});
