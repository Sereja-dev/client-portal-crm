import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * Quotes / Estimates Phase 2.2 — live database behavior coverage for
 * 20260922090000_make_invoice_project_optional. This is an expand-only
 * schema change (Invoice.projectId DROP NOT NULL, onDelete: Restrict
 * deliberately UNCHANGED) — see that migration's own directory and
 * prisma/schema.prisma's Invoice.projectId comment for the full staged-
 * rollout rationale (Phase 2.3 application code, Phase 2.4 the later
 * Restrict -> SetNull decision, neither of which is this task's scope).
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
 * unchanged FK action, still-required clientId, Project-delete still
 * blocked). It deliberately does NOT exercise createInvoiceAction/
 * updateInvoiceAction or any other application code — those already
 * exist, are unmodified by this migration, and continue to be verified
 * by the full pre-existing test/integration/invoices/*.test.ts suite
 * (run unchanged against the shared harness) as this task's own proof
 * that "existing normal Invoice creation with Project remains
 * unaffected." No project-less Invoice product-flow test belongs here —
 * that is Phase 2.3's scope.
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
  it("1/3. applying the complete migration history from zero: Invoice.projectId is nullable, and its FK still has ON DELETE RESTRICT", async () => {
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

        // pg_constraint.confdeltype: 'r' = ON DELETE RESTRICT (the exact
        // value this schema's own history already used before this
        // migration — see the ON DELETE RESTRICT clause added by
        // 20260729033112_require_invoice_project). 'n' would mean SET
        // NULL, which this migration must NOT introduce.
        const fk = await rawClient.query(
          `SELECT confdeltype FROM pg_constraint WHERE conname = 'Invoice_projectId_fkey'`,
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

  it("4. deleting a Project referenced by an Invoice remains blocked by the RESTRICT FK — the Phase 2.2 regression guard", async () => {
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

        // The staged-rollout regression guard: even after this migration,
        // a Project with any Invoice still cannot be deleted — proves
        // Phase 2.2 alone changes zero live delete behavior.
        await expect(rawClient.query(`DELETE FROM "Project" WHERE id = $1`, [ids.projectId])).rejects.toThrow(
          /violates RESTRICT setting of foreign key constraint "Invoice_projectId_fkey"/,
        );

        const stillThere = await rawClient.query(`SELECT id FROM "Project" WHERE id = $1`, [ids.projectId]);
        expect(stillThere.rows).toHaveLength(1);
      } finally {
        await rawClient.end();
      }
    } finally {
      await socketServer.stop();
      await pglite.close();
    }
  }, 30_000);
});
