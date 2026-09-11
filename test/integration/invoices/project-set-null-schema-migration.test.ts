import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

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
 */

const execFileAsync = promisify(execFile);
const REPO_ROOT = `${__dirname}/../../..`;

async function waitForSocketReady(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const client = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`isolated PGlite socket server never became reachable on port ${port}`);
}

async function startIsolatedDatabase(port: number): Promise<{ databaseUrl: string; pglite: PGlite; socketServer: PGLiteSocketServer }> {
  const pglite = new PGlite();
  const socketServer = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port, maxConnections: 5 });
  await socketServer.start();
  await waitForSocketReady(port);
  await pglite.query("CREATE ROLE anon NOLOGIN");
  await pglite.query("CREATE ROLE authenticated NOLOGIN");
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  return { databaseUrl, pglite, socketServer };
}

/** Applies the COMPLETE migration history (every migration, from zero) — this is the actual deployment sequence, not a partial/pre-this-migration state. */
async function deployFullMigrationHistory(databaseUrl: string): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  });
}

describe("20260923090000_set_invoice_project_fk_set_null — live database behavior (isolated, disposable PGlite instances)", () => {
  it("1. applying the complete migration history from zero: Invoice_projectId_fkey's own delete action is SET NULL, not RESTRICT", async () => {
    const port = 55660;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
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
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);

  it("2. Invoice.projectId remains nullable at the database level", async () => {
    const port = 55661;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
        const column = await rawClient.query(
          `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Invoice' AND column_name = 'projectId'`,
        );
        expect(column.rows).toHaveLength(1);
        expect(column.rows[0].is_nullable).toBe("YES");
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);

  it("3. Invoice.clientId remains required (NOT NULL) and its own FK to Client remains RESTRICT — untouched by this migration", async () => {
    const port = 55662;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
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
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);

  it("4. existing Invoice indexes are unchanged (no unrelated CREATE/DROP INDEX introduced)", async () => {
    const port = 55663;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
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
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);
});
