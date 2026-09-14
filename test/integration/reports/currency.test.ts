import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveReportsCurrency } from "@/lib/reports/currency";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { createExtraInvoice, cleanupExtraReportsData } from "./helpers";

describe("resolveReportsCurrency", () => {
  let fixtures: TestFixtures;
  let invoiceIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ invoiceIds });
    invoiceIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("with no invoices at all for this organization: available is empty, selected falls back to the organization's own default currency", async () => {
    const result = await resolveReportsCurrency(fixtures.orgB.id, undefined);
    expect(result.availableCurrencies).toEqual([]);
    // orgB has no OrganizationProfile.currency set -> resolveInvoiceCurrencyDefault falls back to USD, the same default /invoices/new itself would show.
    expect(result.selectedCurrency).toBe("USD");
  });

  it("a requested currency this organization has actually invoiced in is selected", async () => {
    const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD" });
    const eur = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "EUR" });
    invoiceIds = [usd.id, eur.id];

    const usdResult = await resolveReportsCurrency(fixtures.orgA.id, "USD");
    expect(usdResult.selectedCurrency).toBe("USD");
    expect(usdResult.availableCurrencies).toEqual(["EUR", "USD"]);

    const eurResult = await resolveReportsCurrency(fixtures.orgA.id, "EUR");
    expect(eurResult.selectedCurrency).toBe("EUR");
    expect(eurResult.availableCurrencies).toEqual(["EUR", "USD"]);
  });

  it("normalizes a lowercase/whitespace-padded requested currency before matching", async () => {
    const eur = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "EUR" });
    invoiceIds = [eur.id];

    const result = await resolveReportsCurrency(fixtures.orgA.id, "  eur ");
    expect(result.selectedCurrency).toBe("EUR");
  });

  it("a forged/nonexistent currency safely falls back to the organization default rather than being honored", async () => {
    const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD" });
    invoiceIds = [usd.id];

    const result = await resolveReportsCurrency(fixtures.orgA.id, "ZZZ");
    expect(result.selectedCurrency).toBe("USD");
    expect(result.availableCurrencies).toEqual(["USD"]);
  });

  it("a real ISO currency this organization has simply never invoiced in is rejected exactly like a forged one", async () => {
    const usd = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD" });
    invoiceIds = [usd.id];

    // GBP is a perfectly valid, supported invoice currency in general --
    // but this organization has never actually used it, so it must never
    // be selectable here regardless of its own global validity.
    const result = await resolveReportsCurrency(fixtures.orgA.id, "GBP");
    expect(result.selectedCurrency).toBe("USD");
  });

  it("with no requested currency and no matching org default present, falls back to the first available currency alphabetically", async () => {
    // Deliberately org B / client B here, not org A / client A: org A's
    // shared seedTestData() fixture already carries its own pre-existing
    // USD invoice, which would itself satisfy "the org default (USD) is
    // present" and mask exactly the fallback branch this test exists to
    // prove. Org B has zero fixture invoices, so EUR/GBP created here are
    // the only currencies it has ever actually invoiced in.
    const eur = await createExtraInvoice({ organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, amount: "10.00", currency: "EUR" });
    const gbp = await createExtraInvoice({ organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, amount: "10.00", currency: "GBP" });
    invoiceIds = [eur.id, gbp.id];

    // org B's own default resolves to USD (no OrganizationProfile.currency
    // set), which this org has never actually invoiced in -- so the
    // deterministic first-alphabetically fallback (EUR before GBP) applies.
    const result = await resolveReportsCurrency(fixtures.orgB.id, undefined);
    expect(result.selectedCurrency).toBe("EUR");
    expect(result.availableCurrencies).toEqual(["EUR", "GBP"]);
  });

  it("another tenant's invoiced currencies never appear in this organization's available list, and can never be selected", async () => {
    const orgAInvoice = await createExtraInvoice({ organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, amount: "10.00", currency: "USD" });
    const orgBInvoice = await createExtraInvoice({ organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, amount: "10.00", currency: "EUR" });
    invoiceIds = [orgAInvoice.id, orgBInvoice.id];

    const resultA = await resolveReportsCurrency(fixtures.orgA.id, "EUR");
    expect(resultA.availableCurrencies).toEqual(["USD"]);
    expect(resultA.selectedCurrency).toBe("USD"); // EUR (org B's currency) never honored for org A

    const resultB = await resolveReportsCurrency(fixtures.orgB.id, undefined);
    expect(resultB.availableCurrencies).toEqual(["EUR"]);
  });
});
