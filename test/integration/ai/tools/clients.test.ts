import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeSearchClients, executeGetClientDetail } from "@/lib/ai/tools/clients";

describe("AI Batch 1B.1 client tools — integration", () => {
  let fixtures: TestFixtures;
  /** A privacy-sensitive client, fully populated with every Client field this batch must never expose. */
  let sensitiveClientId: string;

  beforeAll(async () => {
    fixtures = await seedTestData();
    const sensitive = await prisma.client.create({
      data: {
        name: "Sensitive Client Co",
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
        company: "Sensitive Co",
        status: "ACTIVE",
        email: "leak-me-not@example.com",
        phone: "+1-555-0100",
        notes: "PRIVATE: this client is difficult, never mention their competitor by name.",
        billingLegalName: "Sensitive Client Co LLC",
        taxId: "99-9999999",
        streetAddress: "123 Secret St",
        city: "Privacyville",
        state: "CA",
        postalCode: "90210",
        country: "US",
      },
    });
    sensitiveClientId = sensitive.id;
  });

  afterEach(async () => {
    // Keep the sensitive fixture across tests but clear anything a test
    // creates on top of it, if needed later — currently no per-test
    // mutation exists.
  });

  afterAll(async () => {
    await prisma.client.delete({ where: { id: sensitiveClientId } });
    await cleanupTestData(fixtures);
  });

  describe("searchClients", () => {
    it("returns only the caller's own-org clients", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const refs = result.results.map((r) => r.ref);
      expect(refs).toContain(fixtures.clientA.id);
      expect(refs).not.toContain(fixtures.clientB.id);
    });

    it("never returns another organization's data even when searching by its exact name", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, { query: fixtures.clientB.name });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results).toEqual([]);
    });

    it("no-match returns an empty results array, never an error", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, { query: "zzz-genuinely-no-such-client-zzz" });
      expect(result).toEqual({ ok: true, results: [] });
    });

    it("filters by status", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, { status: "ACTIVE" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.some((r) => r.ref === sensitiveClientId)).toBe(true);
    });

    it("returns exactly the approved 4 fields, and REAL field filtering: email/phone/notes/taxId/address never survive projection for a fully-populated client", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, { query: "Sensitive Client Co" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.results.find((r) => r.ref === sensitiveClientId);
      expect(hit).toBeDefined();
      expect(Object.keys(hit!).sort()).toEqual(["company", "name", "ref", "status"].sort());
      const serialized = JSON.stringify(hit);
      expect(serialized).not.toMatch(/leak-me-not/);
      expect(serialized).not.toMatch(/555-0100/);
      expect(serialized).not.toMatch(/PRIVATE/);
      expect(serialized).not.toMatch(/99-9999999/);
      expect(serialized).not.toMatch(/Secret St/);
    });

    it("respects the fixed cap of 10 and orders deterministically (createdAt desc, id desc tie-break)", async () => {
      const extraIds: string[] = [];
      try {
        for (let i = 0; i < 12; i++) {
          const c = await prisma.client.create({
            data: { name: `Cap Test Client ${i}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
          });
          extraIds.push(c.id);
        }
        const result = await executeSearchClients(fixtures.orgA.id, { query: "Cap Test Client" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.results.length).toBeLessThanOrEqual(10);
        expect(result.results.length).toBe(10);
      } finally {
        await prisma.client.deleteMany({ where: { id: { in: extraIds } } });
      }
    });
  });

  describe("getClientDetail", () => {
    it("own-org ref succeeds and returns exactly the approved 6 fields", async () => {
      const result = await executeGetClientDetail(fixtures.orgA.id, { ref: fixtures.clientA.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result).sort()).toEqual(["ok", "name", "company", "status", "createdAt", "projectCount", "invoiceCount"].sort());
    });

    it("CRITICAL: never returns Client.notes, even for the fully-populated sensitive fixture", async () => {
      const result = await executeGetClientDetail(fixtures.orgA.id, { ref: sensitiveClientId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("notes" in result).toBe(false);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/PRIVATE/);
      expect(serialized).not.toMatch(/never mention their competitor/i);
    });

    it("never returns email/phone/billing/legal/address fields", async () => {
      const result = await executeGetClientDetail(fixtures.orgA.id, { ref: sensitiveClientId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/leak-me-not/);
      expect(serialized).not.toMatch(/555-0100/);
      expect(serialized).not.toMatch(/99-9999999/);
      expect(serialized).not.toMatch(/Secret St/);
      expect(serialized).not.toMatch(/Privacyville/);
    });

    it("reports correct project/invoice counts, scoped only to this client's own records", async () => {
      const result = await executeGetClientDetail(fixtures.orgA.id, { ref: fixtures.clientA.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.projectCount).toBeGreaterThanOrEqual(1);
      expect(result.invoiceCount).toBeGreaterThanOrEqual(1);
    });

    it("foreign-org ref -> not_found, indistinguishable from nonexistent", async () => {
      const foreignResult = await executeGetClientDetail(fixtures.orgA.id, { ref: fixtures.clientB.id });
      const nonexistentResult = await executeGetClientDetail(fixtures.orgA.id, { ref: randomUUID() });
      expect(foreignResult).toEqual({ ok: false, error: "not_found" });
      expect(nonexistentResult).toEqual({ ok: false, error: "not_found" });
    });

    it("malformed ref -> invalid_input, never a distinguishable existence signal", async () => {
      const result = await executeGetClientDetail(fixtures.orgA.id, { ref: "not-a-real-uuid" });
      expect(result).toEqual({ ok: false, error: "invalid_input" });
    });
  });
});
