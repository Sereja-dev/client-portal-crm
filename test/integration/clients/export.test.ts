import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";

const { GET } = await import("@/app/api/clients/export/route");

/**
 * CSV Import/Export Phase 1 — Client export Route Handler. Covers
 * permissions (OWNER/ADMIN only, MEMBER/unauthenticated/Portal denied),
 * tenant isolation (organizationId is always server-resolved, never
 * read from the query string; a foreign-org row is never exported),
 * filter parity with the exact same buildClientWhere the Clients list
 * page uses, pagination being ignored, and the CSV content itself
 * (human-readable status/tags, formula-injection neutralization).
 */
function req(query = ""): Request {
  return new Request(`http://127.0.0.1/api/clients/export${query ? `?${query}` : ""}`);
}

function parseCsv(body: string): string[][] {
  const withoutBom = body.replace(/^﻿/, "");
  return withoutBom
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

describe("GET /api/clients/export", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("permissions", () => {
    it("no session -> redirects (RedirectSignal), never exports", async () => {
      const { RedirectSignal } = await import("../../support/navigation-mock");
      let caught: unknown;
      try {
        await GET(req());
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RedirectSignal);
    });

    it("Portal identity cannot use the Staff export endpoint", async () => {
      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      // A portal identity has no Membership at all, so getCurrentMembership()
      // resolves it via getOrCreateUser() -> redirect("/portal") (a
      // different identity-type redirect, never a Staff export response).
      const { RedirectSignal } = await import("../../support/navigation-mock");
      let caught: unknown;
      try {
        await GET(req());
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RedirectSignal);
    });

    it("MEMBER is denied server-side with 403, never a 200", async () => {
      actAs(fixtures.member, fixtures.orgA.id);
      const res = await GET(req());
      expect(res.status).toBe(403);
    });

    it("ADMIN can export", async () => {
      actAs(fixtures.admin, fixtures.orgA.id);
      const res = await GET(req());
      expect(res.status).toBe(200);
    });

    it("OWNER can export", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      expect(res.status).toBe(200);
    });
  });

  describe("response shape", () => {
    it("returns CSV content-type, attachment disposition with a deterministic filename, and a private no-store cache header", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="clients.csv"');
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("the body begins with a UTF-8 BOM and the expected header row", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      // Response#text() decodes via the standard Fetch UTF-8 algorithm,
      // which strips a leading BOM as part of decoding (the same thing a
      // browser tab would do) — so the BOM's actual presence on the wire
      // must be checked at the byte level instead, via arrayBuffer().
      const bytes = new Uint8Array(await res.clone().arrayBuffer());
      expect(bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));

      const body = await res.text();
      const rows = parseCsv(body);
      expect(rows[0]).toEqual([
        "ID",
        "Name",
        "Company",
        "Email",
        "Phone",
        "Status",
        "Notes",
        "Billing Legal Name",
        "Tax ID",
        "Street Address",
        "City",
        "State",
        "Postal Code",
        "Country",
        "Tags",
        "Created At",
        "Updated At",
      ]);
    });
  });

  describe("tenant isolation", () => {
    it("never exports a foreign-organization Client, and organizationId is never read from the query string", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      // A crafted organizationId query param must be silently ignored —
      // the route never even looks at it (getCurrentMembership() is the
      // only source of organizationId).
      const res = await GET(req(`organizationId=${fixtures.orgB.id}`));
      const body = await res.text();
      expect(body).not.toContain(fixtures.clientB.name);
      expect(body).toContain(fixtures.clientA.name);
    });
  });

  describe("filter parity with the Clients list page's own buildClientWhere", () => {
    it("search (q) narrows to only matching rows, across the whole result set, not just one page", async () => {
      const matching = await prisma.client.create({
        data: { name: `Export-Match-${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      const nonMatching = await prisma.client.create({
        data: { name: `Different-${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });

      try {
        actAs(fixtures.owner, fixtures.orgA.id);
        const res = await GET(req(`q=${encodeURIComponent("Export-Match")}`));
        const body = await res.text();
        expect(body).toContain(matching.name);
        expect(body).not.toContain(nonMatching.name);
      } finally {
        await prisma.client.deleteMany({ where: { id: { in: [matching.id, nonMatching.id] } } });
      }
    });

    it("ignores pagination entirely — exports every matching row, well beyond one list page's worth", async () => {
      const created = await prisma.client.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          name: `Bulk-Export-${i}-${randomUUID().slice(0, 6)}`,
          organizationId: fixtures.orgA.id,
          userId: fixtures.owner.id,
        })),
      });
      expect(created.count).toBe(30);

      try {
        actAs(fixtures.owner, fixtures.orgA.id);
        const res = await GET(req(`q=${encodeURIComponent("Bulk-Export-")}`));
        const body = await res.text();
        const rows = parseCsv(body);
        // header + 30 data rows — every one of the 30 seeded rows above,
        // never bounded to a single list page's own PAGE_SIZE.
        expect(rows.length).toBe(31);
      } finally {
        await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Bulk-Export-" } } });
      }
    });
  });

  describe("CSV content correctness", () => {
    it("exports the human-readable status label, never the raw statusDefinitionId", async () => {
      const definition = await prisma.customStatusDefinition.create({
        data: {
          organizationId: fixtures.orgA.id,
          entityType: "CLIENT",
          key: "vip",
          label: "VIP Client",
          color: "SUCCESS",
          position: 0,
        },
      });
      const client = await prisma.client.create({
        data: {
          name: `Status-Label-${randomUUID().slice(0, 8)}`,
          organizationId: fixtures.orgA.id,
          userId: fixtures.owner.id,
          statusDefinitionId: definition.id,
        },
      });

      try {
        actAs(fixtures.owner, fixtures.orgA.id);
        const res = await GET(req());
        const body = await res.text();
        expect(body).toContain("VIP Client");
        expect(body).not.toContain(definition.id);
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });

    it("neutralizes a formula-injection-shaped Client name and still round-trips the rest of the row", async () => {
      const client = await prisma.client.create({
        data: {
          name: "=cmd|'/c calc'!A1",
          organizationId: fixtures.orgA.id,
          userId: fixtures.owner.id,
        },
      });

      try {
        actAs(fixtures.owner, fixtures.orgA.id);
        const res = await GET(req());
        const body = await res.text();
        // The raw, un-neutralized formula string must never appear —
        // only the quote-prefixed, safe form.
        expect(body).not.toContain(`,=cmd|'/c calc'!A1,`);
        expect(body).toContain(`'=cmd|'/c calc'!A1`);
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });
  });
});
