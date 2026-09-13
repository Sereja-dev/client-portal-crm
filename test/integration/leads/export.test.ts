import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

const { GET } = await import("@/app/api/leads/export/route");

/**
 * CSV Import/Export Phase 1 — Lead export Route Handler. Mirrors
 * clients/export.test.ts's own coverage exactly (permissions, tenant
 * isolation, filter parity, pagination-ignored, CSV content), plus the
 * Lead-specific concerns: human-readable Source/Stage/Assignee, Value
 * serialized as a plain (never formula-neutralized) number, and the
 * default-active/opt-in-archived `archived` filter.
 */
function req(query = ""): Request {
  return new Request(`http://127.0.0.1/api/leads/export${query ? `?${query}` : ""}`);
}

function parseCsv(body: string): string[][] {
  // Excel Compatibility Fix — every document now leads with a bare
  // "sep=," directive line (after the BOM, before the real header; see
  // src/lib/csv/serialize.ts's own doc comment). Stripped here so every
  // existing rows[0]-is-the-header assertion below keeps working
  // unchanged; the directive's own presence/shape is proven separately
  // by "the body's on-wire bytes begin with a UTF-8 BOM, then the bare
  // sep=, directive, and the header row is as expected".
  const withoutBom = body.replace(/^﻿/, "");
  const withoutDirective = withoutBom.replace(/^sep=,\r\n/, "");
  return withoutDirective
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

async function createLead(
  fixtures: TestFixtures,
  overrides: Partial<{
    name: string;
    source: "REFERRAL" | "WEBSITE" | "SOCIAL" | "OUTREACH" | "OTHER";
    stage: string;
    value: string;
    assignedToUserId: string;
    archivedAt: Date;
    organizationId: string;
  }> = {},
) {
  const { organizationId = fixtures.orgA.id, ...rest } = overrides;
  return prisma.lead.create({
    data: {
      name: rest.name ?? `Lead-${randomUUID().slice(0, 8)}`,
      organizationId,
      source: rest.source,
      stage: (rest.stage as never) ?? "NEW",
      value: rest.value,
      assignedToUserId: rest.assignedToUserId,
      archivedAt: rest.archivedAt,
    },
  });
}

describe("GET /api/leads/export", () => {
  let fixtures: TestFixtures;
  const createdLeadIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    if (createdLeadIds.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
      createdLeadIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("permissions", () => {
    it("no session -> redirects, never exports", async () => {
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
    it("returns CSV content-type, attachment disposition, and a private no-store cache header", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="leads.csv"');
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("the body's on-wire bytes begin with a UTF-8 BOM, then the bare sep=, directive, and the header row is as expected", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      const bytes = new Uint8Array(await res.clone().arrayBuffer());
      expect(bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));

      const body = await res.text();
      // Excel Compatibility Fix: the directive is the first real line
      // after the BOM (bare, unquoted, never a data row) — this is what
      // makes Excel resolve the correct column delimiter regardless of
      // the opening machine's regional "list separator" setting.
      expect(body.replace(/^﻿/, "").split("\r\n")[0]).toBe("sep=,");

      const rows = parseCsv(body);
      expect(rows[0]).toEqual([
        "ID",
        "Name",
        "Company",
        "Email",
        "Phone",
        "Source",
        "Stage",
        "Value",
        "Notes",
        "Assignee",
        "Tags",
        "Archived",
        "Created At",
        "Updated At",
      ]);
    });
  });

  describe("tenant isolation", () => {
    it("never exports a foreign-organization Lead, and organizationId is never read from the query string", async () => {
      const leadB = await createLead(fixtures, { organizationId: fixtures.orgB.id, name: "Foreign-Org-Lead" });
      createdLeadIds.push(leadB.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req(`organizationId=${fixtures.orgB.id}`));
      const body = await res.text();
      expect(body).not.toContain("Foreign-Org-Lead");
    });
  });

  describe("filter parity with the Leads list page's own buildLeadWhere", () => {
    it("search (q) narrows to only matching rows", async () => {
      const matching = await createLead(fixtures, { name: `Export-Match-${randomUUID().slice(0, 8)}` });
      const nonMatching = await createLead(fixtures, { name: `Different-${randomUUID().slice(0, 8)}` });
      createdLeadIds.push(matching.id, nonMatching.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req(`q=${encodeURIComponent("Export-Match")}`));
      const body = await res.text();
      expect(body).toContain(matching.name);
      expect(body).not.toContain(nonMatching.name);
    });

    it("ignores pagination entirely — exports every matching row, well beyond one list page's worth", async () => {
      const leads = await Promise.all(
        Array.from({ length: 30 }, (_, i) => createLead(fixtures, { name: `Bulk-Export-${i}-${randomUUID().slice(0, 6)}` })),
      );
      createdLeadIds.push(...leads.map((l) => l.id));

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req(`q=${encodeURIComponent("Bulk-Export-")}`));
      const rows = parseCsv(await res.text());
      expect(rows.length).toBe(31);
    });

    it("archived defaults to excluded; ?archived=1 exports the archived set instead, not both at once", async () => {
      const active = await createLead(fixtures, { name: `Active-${randomUUID().slice(0, 8)}` });
      const archived = await createLead(fixtures, {
        name: `Archived-${randomUUID().slice(0, 8)}`,
        archivedAt: new Date(),
      });
      createdLeadIds.push(active.id, archived.id);

      actAs(fixtures.owner, fixtures.orgA.id);

      const defaultRes = await GET(req());
      const defaultBody = await defaultRes.text();
      expect(defaultBody).toContain(active.name);
      expect(defaultBody).not.toContain(archived.name);

      const archivedRes = await GET(req("archived=1"));
      const archivedBody = await archivedRes.text();
      expect(archivedBody).toContain(archived.name);
      expect(archivedBody).not.toContain(active.name);
    });
  });

  describe("CSV content correctness", () => {
    it("exports human-readable Source/Stage/Assignee, never raw ids", async () => {
      const lead = await createLead(fixtures, {
        name: `Presentation-${randomUUID().slice(0, 8)}`,
        source: "REFERRAL",
        assignedToUserId: fixtures.owner.id,
      });
      createdLeadIds.push(lead.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      const body = await res.text();
      const rows = parseCsv(body);
      const row = rows.find((r) => r[1] === lead.name);
      expect(row).toBeDefined();
      expect(row![5]).toBe("Referral"); // Source, human-readable
      expect(row![6]).toBe("New"); // Stage, human-readable (system NEW definition label)
      expect(row![9]).toBe(fixtures.owner.name); // Assignee name, not assignedToUserId
      expect(body).not.toContain(fixtures.owner.id);
    });

    it("Value is serialized as a plain number, never neutralized even when negative, distinct from ordinary text columns", async () => {
      const lead = await createLead(fixtures, {
        name: `Value-Test-${randomUUID().slice(0, 8)}`,
        value: "-500.00",
      });
      createdLeadIds.push(lead.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      const rows = parseCsv(await res.text());
      const row = rows.find((r) => r[1] === lead.name);
      expect(row).toBeDefined();
      // A plain "-500" — not quote-prefixed (which would be the
      // formula-neutralization applied to a *text* column).
      expect(row![7]).toBe("-500");
    });

    it("neutralizes a formula-injection-shaped Lead name and notes", async () => {
      const lead = await createLead(fixtures, { name: "=cmd|'/c calc'!A1" });
      await prisma.lead.update({ where: { id: lead.id }, data: { notes: "+HYPERLINK(1)" } });
      createdLeadIds.push(lead.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      const body = await res.text();
      expect(body).not.toContain(`,=cmd|'/c calc'!A1,`);
      expect(body).toContain(`'=cmd|'/c calc'!A1`);
      expect(body).toContain("'+HYPERLINK(1)");
    });

    it("Archived column reads Yes/No", async () => {
      const active = await createLead(fixtures, { name: `Archived-Col-Active-${randomUUID().slice(0, 8)}` });
      createdLeadIds.push(active.id);

      actAs(fixtures.owner, fixtures.orgA.id);
      const res = await GET(req());
      const rows = parseCsv(await res.text());
      const row = rows.find((r) => r[1] === active.name);
      expect(row).toBeDefined();
      expect(row![11]).toBe("No");
    });
  });
});
