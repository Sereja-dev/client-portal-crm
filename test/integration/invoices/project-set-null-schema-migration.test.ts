import { describe, expect, it } from "vitest";
import { withIsolatedDatabase } from "../../support/isolated-postgres";

/**
 * Quotes / Estimates Phase 2.4 — live database behavior coverage for
 * 20260923090000_set_invoice_project_fk_set_null. This flips ONLY
 * Invoice_projectId_fkey's own delete action (RESTRICT -> SET NULL); see
 * that migration's own directory and prisma/schema.prisma's
 * Invoice.projectId comment for the full staged-rollout rationale.
 * Mirrors test/integration/invoices/project-optional-schema-migration.
 * test.ts's own Phase 2.2 sibling exactly (same isolated-PGlite-per-test
 * technique, same reasoning for not using the shared harness — see that
 * file's own header comment) on its own dedicated ports (55660-55663) so
 * neither file can ever collide with the other's sockets.
 *
 * This file only proves the SCHEMA/DB-level contract (FK action, still-
 * nullable projectId, still-required clientId, unchanged indexes). The
 * live application-level behavior of an actual Project deletion (Invoice
 * survives, projectId becomes null, exactly one Activity row) is proven
 * against the real app code in test/integration/projects/delete.test.ts
 * and test/integration/invoices/project-deleted-invoice-survives.test.ts
 * instead — this file never calls deleteProjectAction.
 *
 * Isolated PGlite lifecycle repair — the per-test PGlite/socket/raw-
 * client lifecycle now lives in the shared, hardened test/support/
 * isolated-postgres.ts (see that module's own header comment for the
 * proven root cause of the documented "unexpected parseComplete" race
 * this replaces). Every query/assertion below is otherwise byte-for-byte
 * unchanged — only the surrounding boilerplate (port/client/teardown)
 * was replaced by `withIsolatedDatabase`'s own single callback.
 */

const REPO_ROOT = `${__dirname}/../../..`;

describe("20260923090000_set_invoice_project_fk_set_null — live database behavior (isolated, disposable PGlite instances)", () => {
  it("1. applying the complete migration history from zero: Invoice_projectId_fkey's own delete action is SET NULL, not RESTRICT", async () => {
    await withIsolatedDatabase(55660, REPO_ROOT, async (rawClient) => {
      // pg_constraint.confdeltype: 'n' = ON DELETE SET NULL (the value
      // this migration must introduce). 'r' (RESTRICT) was the prior
      // value, set by 20260729033112_require_invoice_project and left
      // unchanged through 20260922090000_make_invoice_project_optional
      // (Phase 2.2's own deliberate scope limit).
      const fk = await rawClient.query(
        `SELECT confdeltype FROM pg_constraint WHERE conname = 'Invoice_projectId_fkey'`,
      );
      expect(fk.rows).toHaveLength(1);
      expect(fk.rows[0].confdeltype).toBe("n");
    });
  }, 30_000);

  it("2. Invoice.projectId remains nullable at the database level", async () => {
    await withIsolatedDatabase(55661, REPO_ROOT, async (rawClient) => {
      const column = await rawClient.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Invoice' AND column_name = 'projectId'`,
      );
      expect(column.rows).toHaveLength(1);
      expect(column.rows[0].is_nullable).toBe("YES");
    });
  }, 30_000);

  it("3. Invoice.clientId remains required (NOT NULL) and its own FK to Client remains RESTRICT — untouched by this migration", async () => {
    await withIsolatedDatabase(55662, REPO_ROOT, async (rawClient) => {
      const column = await rawClient.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Invoice' AND column_name = 'clientId'`,
      );
      expect(column.rows).toHaveLength(1);
      expect(column.rows[0].is_nullable).toBe("NO");

      const fk = await rawClient.query(
        `SELECT confdeltype FROM pg_constraint WHERE conname = 'Invoice_clientId_fkey'`,
      );
      expect(fk.rows).toHaveLength(1);
      expect(fk.rows[0].confdeltype).toBe("r");
    });
  }, 30_000);

  it("4. existing Invoice indexes are unchanged (no unrelated CREATE/DROP INDEX introduced)", async () => {
    await withIsolatedDatabase(55663, REPO_ROOT, async (rawClient) => {
      const indexes = await rawClient.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'Invoice'`);
      const names = indexes.rows.map((r) => r.indexname as string).sort();
      expect(names).toEqual(
        [
          "Invoice_pkey",
          "Invoice_pdfStoragePath_key",
          "Invoice_organizationId_invoiceNumber_key",
          "Invoice_status_idx",
          "Invoice_dueDate_idx",
          "Invoice_projectId_idx",
          "Invoice_organizationId_idx",
          // Recurring Invoices Phase 1 (migration
          // 20260930090000_add_recurring_invoices_foundation) — a new
          // index for the new recurringInvoiceId FK column, unrelated to
          // this migration's own project-optional/SetNull change.
          "Invoice_recurringInvoiceId_idx",
        ].sort(),
      );
    });
  }, 30_000);
});
