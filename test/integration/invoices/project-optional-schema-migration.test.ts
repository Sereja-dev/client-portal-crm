import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * Quotes / Estimates Phase 2.2 — live database behavior coverage for
 * 20260922090000_make_invoice_project_optional. This is an expand-only
 * schema change (Invoice.projectId DROP NOT NULL; at the time this
 * migration shipped, onDelete: Restrict was deliberately left UNCHANGED)
 * — see that migration's own directory and prisma/schema.prisma's
 * Invoice.projectId comment for the full staged-rollout rationale.
 *
 * Superseded by Phase 2.4 (20260923090000_set_invoice_project_fk_set_
 * null): every test below deploys the COMPLETE migration history from
 * zero — never a snapshot pinned to this migration alone — so once Phase
 * 2.4 shipped, the FK-action and Project-delete-blocked assertions this
 * file originally made stopped describing reality and were updated in
 * place below to describe the CURRENT (SET NULL) behavior instead, with
 * this comment kept as the historical record of what Phase 2.2 alone
 * changed. The still-current, Phase-2.4-owned version of these same two
 * checks now also lives in test/integration/invoices/project-set-null-
 * schema-migration.test.ts and test/integration/projects/delete.test.ts
 * — this file is not deleted only because it still independently proves
 * the OTHER three Phase 2.2 facts below (nullable column, unchanged
 * clientId, unchanged indexes), which remain true and unrelated to
 * either FK's own delete action.
 *
 * Deliberately does NOT use this suite's own shared harness
 * (test/support/local-postgres.ts, port 55432, started once by
 * test/integration/global-setup.ts) — same reasoning as test/integration/
 * invoices/invoice-number-organization-migration-contract.test.ts's own
 * header comment: every test below starts its own fresh, disposable,
 * fully-isolated PGlite instance on its own dedicated port instead, so
 * applying the complete migration history "from zero" here can never
 * affect the shared harness or any other test file.
 *
 * This file only proves the SCHEMA/DB-level contract (nullable column,
 * current FK action, still-required clientId). It deliberately does NOT
 * exercise createInvoiceAction/updateInvoiceAction or any other
 * application code — those already exist, are unmodified by this
 * migration, and continue to be verified by the full pre-existing
 * test/integration/invoices/*.test.ts suite (run unchanged against the
 * shared harness) as this task's own proof that "existing normal Invoice
 * creation with Project remains unaffected." No project-less Invoice
 * product-flow test belongs here — that is Phase 2.3's scope.
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

async function seedOrgClientProject(
  rawClient: pg.Client,
  ids: { orgId: string; userId: string; clientId: string; projectId: string; orgSlug: string; userEmail: string },
): Promise<void> {
  await rawClient.query(
    `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Probe Org', $2, now(), now())`,
    [ids.orgId, ids.orgSlug],
  );
  await rawClient.query(
    `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'Probe User', now(), now())`,
    [ids.userId, ids.userEmail],
  );
  await rawClient.query(
    `INSERT INTO "Client" (id, name, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'Probe Client', $2, $3, now(), now())`,
    [ids.clientId, ids.userId, ids.orgId],
  );
  await rawClient.query(
    `INSERT INTO "Project" (id, name, "clientId", "organizationId", "ownerId", status, "createdAt", "updatedAt") VALUES ($1, 'Probe Project', $2, $3, $4, 'IN_PROGRESS', now(), now())`,
    [ids.projectId, ids.clientId, ids.orgId, ids.userId],
  );
}

describe("20260922090000_make_invoice_project_optional — live database behavior (isolated, disposable PGlite instances)", () => {
  it("1/3. applying the complete migration history from zero: Invoice.projectId is nullable, and its FK's own delete action is the current one (SET NULL as of Phase 2.4)", async () => {
    const port = 55650;
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

        // pg_constraint.confdeltype: 'r' = ON DELETE RESTRICT was this
        // migration's own contemporary value (unchanged from the clause
        // 20260729033112_require_invoice_project first added), and this
        // migration itself deliberately did NOT introduce 'n' (SET NULL).
        // That stopped being the value applying the FULL current history
        // produces the moment 20260923090000_set_invoice_project_fk_set_
        // null shipped (Phase 2.4) — this assertion now reflects THAT
        // migration's own value instead, since this test can only ever
        // observe the end state of the complete history, never a pinned
        // snapshot of this migration alone.
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

  it("2. Invoice.clientId remains required (NOT NULL) at the database level", async () => {
    const port = 55651;
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
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);

  it("existing Invoice indexes are unchanged (no unrelated CREATE/DROP INDEX introduced)", async () => {
    const port = 55652;
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
            // this migration's own project-optional change.
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

  it("a null-projectId Invoice row is accepted at the database level (direct SQL, never through any application code path)", async () => {
    const port = 55653;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
        const orgId = "eeeeeeee-0000-0000-0000-000000000001";
        const clientId = "eeeeeeee-0000-0000-0000-000000000003";
        await rawClient.query(
          `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Probe Org', 'probe-org-nullproj', now(), now())`,
          [orgId],
        );
        await rawClient.query(
          `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ('eeeeeeee-0000-0000-0000-000000000002', 'probe-nullproj@example.com', 'Probe User', now(), now())`,
        );
        await rawClient.query(
          `INSERT INTO "Client" (id, name, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'Probe Client', 'eeeeeeee-0000-0000-0000-000000000002', $2, now(), now())`,
          [clientId, orgId],
        );

        await expect(
          rawClient.query(
            `INSERT INTO "Invoice" (id, "invoiceNumber", status, amount, "issueDate", "clientId", "projectId", "organizationId", "createdAt", "updatedAt")
             VALUES ('eeeeeeee-0000-0000-0000-000000000005', 'NULLPROJ-1', 'DRAFT', 10.00, now(), $1, NULL, $2, now(), now())`,
            [clientId, orgId],
          ),
        ).resolves.toBeDefined();

        const row = await rawClient.query(`SELECT "projectId" FROM "Invoice" WHERE id = 'eeeeeeee-0000-0000-0000-000000000005'`);
        expect(row.rows[0].projectId).toBeNull();
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);

  it("4. deleting a Project referenced by an Invoice — raw-SQL-level regression guard, updated for Phase 2.4's SET NULL", async () => {
    const port = 55654;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    try {
      await deployFullMigrationHistory(databaseUrl);

      const rawClient = new pg.Client({ connectionString: databaseUrl });
      await rawClient.connect();
      try {
        const orgId = "ffffffff-0000-0000-0000-000000000001";
        const ids = {
          orgId,
          userId: "ffffffff-0000-0000-0000-000000000002",
          clientId: "ffffffff-0000-0000-0000-000000000003",
          projectId: "ffffffff-0000-0000-0000-000000000004",
          orgSlug: "probe-org-restrict",
          userEmail: "probe-restrict@example.com",
        };
        await seedOrgClientProject(rawClient, ids);
        await rawClient.query(
          `INSERT INTO "Invoice" (id, "invoiceNumber", status, amount, "issueDate", "clientId", "projectId", "organizationId", "createdAt", "updatedAt")
           VALUES ('ffffffff-0000-0000-0000-000000000005', 'RESTRICT-1', 'DRAFT', 10.00, now(), $1, $2, $3, now(), now())`,
          [ids.clientId, ids.projectId, orgId],
        );

        // As of Phase 2.2 alone, this raw DELETE was still rejected — the
        // staged rollout deliberately changed zero live delete behavior
        // at that point (see this file's own header comment). Once Phase
        // 2.4's migration is in the applied history (as it always is
        // here — full history from zero, never a pinned snapshot), the
        // same raw DELETE now succeeds and the FK's own SET NULL action
        // resets the Invoice's projectId, entirely at the database level
        // — no application code involved in this test at all.
        await expect(rawClient.query(`DELETE FROM "Project" WHERE id = $1`, [ids.projectId])).resolves.toBeDefined();

        const stillThere = await rawClient.query(`SELECT id FROM "Project" WHERE id = $1`, [ids.projectId]);
        expect(stillThere.rows).toHaveLength(0);

        const survivingInvoice = await rawClient.query(`SELECT "projectId" FROM "Invoice" WHERE id = 'ffffffff-0000-0000-0000-000000000005'`);
        expect(survivingInvoice.rows).toHaveLength(1);
        expect(survivingInvoice.rows[0].projectId).toBeNull();
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);
});
