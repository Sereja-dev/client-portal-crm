import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Recurring Invoices Phase 2B-1 — the new due-index migration (test items
 * 32/33). The shared integration test database already has every
 * migration applied (see test/integration/global-setup.ts), including
 * this one, so a direct pg_indexes introspection is sufficient — no
 * dedicated isolated PGlite pair needed for a single-index migration.
 */

const MIGRATION_PATH = "prisma/migrations/20261001090000_add_recurring_invoice_due_index/migration.sql";

describe("32. the composite (status, nextIssueDate) index exists", () => {
  it("RecurringInvoice_status_nextIssueDate_idx is a real index on (status, nextIssueDate)", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='RecurringInvoice' AND indexname='RecurringInvoice_status_nextIssueDate_idx';
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("(status,");
    expect(rows[0].indexdef).toContain('"nextIssueDate"');
    // status must lead, nextIssueDate must trail — the correct
    // equality-then-range composite-index column order.
    expect(rows[0].indexdef.indexOf("status")).toBeLessThan(rows[0].indexdef.indexOf('"nextIssueDate"'));
  });
});

describe("33. the migration contains no unrelated statusDefinitionId drift", () => {
  it("the migration file's own executable SQL statements contain only the one CreateIndex, no DROP/ADD CONSTRAINT for Client/Lead/Project.statusDefinitionId", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // Strip comment lines (the header intentionally documents, in prose,
    // what was removed — "DROP CONSTRAINT" legitimately appears there;
    // only the real executable statements matter for this assertion).
    const executableSql = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executableSql).not.toContain("DROP CONSTRAINT");
    expect(executableSql).not.toContain("ADD CONSTRAINT");
    expect(executableSql).not.toContain("statusDefinitionId_fkey");
    expect(executableSql).toContain('CREATE INDEX "RecurringInvoice_status_nextIssueDate_idx"');
  });
});
