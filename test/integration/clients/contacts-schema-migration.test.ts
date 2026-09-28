import { describe, expect, it } from "vitest";
import { withIsolatedDatabase, reconnectIsolatedRawClient, endIsolatedRawClient, type IsolatedRawClient } from "../../support/isolated-postgres";

/**
 * Multiple Contacts Phase 1 — live database behavior coverage for
 * 20260924090000_add_client_contacts_foundation. Mirrors test/integration/
 * invoices/project-set-null-schema-migration.test.ts's own exact isolated-
 * PGlite-per-test technique (own dedicated ports, 55670-55677, so this
 * file can never collide with any other file's sockets — see that file's
 * own header comment for why an isolated instance is used instead of the
 * shared harness: a schema/constraint-level assertion needs to inspect
 * pg_constraint/pg_indexes directly, which the shared harness's own
 * Prisma client doesn't expose).
 *
 * This file only proves the SCHEMA/DB-level contract. The live
 * application-level behavior (create/update/archive/setPrimary, and the
 * atomic create-time contact creation) is proven against the real app
 * code in contacts.test.ts, create.test.ts, update.test.ts, delete.test.ts,
 * and leads/convert.test.ts instead — this file never calls any of that
 * application code.
 *
 * Isolated PGlite lifecycle repair — the per-file PGlite/socket/raw-
 * client lifecycle now lives in the shared, hardened test/support/
 * isolated-postgres.ts (see that module's own header comment for the
 * proven root cause of the documented "unexpected parseComplete" race
 * this replaces). This file keeps only a thin, same-name `withIsolatedDb`
 * wrapper so every `it()` body below is completely unchanged.
 *
 * Response-misrouting workaround — test "6/7" runs two further queries on
 * the same raw client immediately after an expected-rejection query;
 * that exact shape is the one proven (see isolated-postgres.ts's own
 * header comment) to risk PGlite misattributing a phantom trailing
 * protocol message to the next query. It reconnects to a fresh raw client
 * (same isolated database, same already-applied schema/data) via
 * `reconnectIsolatedRawClient` immediately after the expected-rejection
 * query, before either of the two queries that follow it. Every other
 * test in this file has no rejection at all, so needs no reconnect.
 */

const REPO_ROOT = `${__dirname}/../../..`;

async function withIsolatedDb(port: number, fn: (rawClient: IsolatedRawClient, databaseUrl: string) => Promise<void>): Promise<void> {
  await withIsolatedDatabase(port, REPO_ROOT, fn);
}

describe("20260924090000_add_client_contacts_foundation — live database behavior (isolated, disposable PGlite instances)", () => {
  it("1. applying the complete migration history from zero creates the ClientContact table", async () => {
    await withIsolatedDb(55670, async (rawClient) => {
      const table = await rawClient.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'ClientContact'`,
      );
      expect(table.rows).toHaveLength(1);
    });
  }, 30_000);

  it("2/3. clientId and organizationId are both required (NOT NULL)", async () => {
    await withIsolatedDb(55671, async (rawClient) => {
      const columns = await rawClient.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'ClientContact' AND column_name IN ('clientId', 'organizationId')`,
      );
      const byName = Object.fromEntries(columns.rows.map((r) => [r.column_name, r.is_nullable]));
      expect(byName.clientId).toBe("NO");
      expect(byName.organizationId).toBe("NO");
    });
  }, 30_000);

  it("4. ClientContact_clientId_fkey is ON DELETE CASCADE (contacts never block deleting a Client)", async () => {
    await withIsolatedDb(55672, async (rawClient) => {
      const fk = await rawClient.query(`SELECT confdeltype FROM pg_constraint WHERE conname = 'ClientContact_clientId_fkey'`);
      expect(fk.rows).toHaveLength(1);
      // 'c' = ON DELETE CASCADE.
      expect(fk.rows[0].confdeltype).toBe("c");
    });
  }, 30_000);

  it("ClientContact_organizationId_fkey is also ON DELETE CASCADE — the same direct-tenant-scoping shape Lead/Quote/Comment/Attachment already use", async () => {
    await withIsolatedDb(55673, async (rawClient) => {
      const fk = await rawClient.query(
        `SELECT confdeltype FROM pg_constraint WHERE conname = 'ClientContact_organizationId_fkey'`,
      );
      expect(fk.rows).toHaveLength(1);
      expect(fk.rows[0].confdeltype).toBe("c");
    });
  }, 30_000);

  it("5. email carries no unique constraint of any kind (same policy as Client.email itself)", async () => {
    await withIsolatedDb(55674, async (rawClient) => {
      const indexes = await rawClient.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'ClientContact' AND indexdef ILIKE '%email%'`,
      );
      for (const row of indexes.rows) {
        expect(row.indexdef).not.toMatch(/UNIQUE/i);
      }
    });
  }, 30_000);

  it("6/7. the primary-contact partial unique index exists and is genuinely enforced at the database level (a second concurrent active primary for the same Client is rejected)", async () => {
    await withIsolatedDb(55675, async (initialRawClient, databaseUrl) => {
      let rawClient = initialRawClient;
      const index = await rawClient.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'ClientContact' AND indexname = 'client_contact_one_active_primary'`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toMatch(/UNIQUE/i);
      expect(index.rows[0].indexdef).toContain('"isPrimary"');
      expect(index.rows[0].indexdef).toContain('"archivedAt"');

      // Behavioral proof, not just DDL inspection: seed one Organization
      // and Client, insert one active primary, then attempt a second —
      // the raw INSERT itself must fail with a unique-violation.
      const orgId = "33333333-3333-3333-3333-333333333333";
      const userId = "44444444-4444-4444-4444-444444444444";
      const clientId = "55555555-5555-5555-5555-555555555555";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-schema-test', now(), now())`, [orgId]);
      await rawClient.query(`INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, 'u@x.test', 'U', now(), now())`, [userId]);
      await rawClient.query(
        `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'C', 'ACTIVE', $2, $3, now(), now())`,
        [clientId, userId, orgId],
      );
      await rawClient.query(
        `INSERT INTO "ClientContact" (id, "organizationId", "clientId", name, "isPrimary", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'First', true, now(), now())`,
        [orgId, clientId],
      );

      await expect(
        rawClient.query(
          `INSERT INTO "ClientContact" (id, "organizationId", "clientId", name, "isPrimary", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'Second', true, now(), now())`,
          [orgId, clientId],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);

      // Response-misrouting workaround: two further queries immediately
      // follow this expected rejection, so reconnect first (see this
      // file's own header comment).
      rawClient = await reconnectIsolatedRawClient(rawClient, databaseUrl);

      // An ARCHIVED second primary, or a second non-primary contact, are
      // both legitimate and must NOT be rejected by the same index.
      await expect(
        rawClient.query(
          `INSERT INTO "ClientContact" (id, "organizationId", "clientId", name, "isPrimary", "archivedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'Archived primary', true, now(), now(), now())`,
          [orgId, clientId],
        ),
      ).resolves.toBeDefined();
      await expect(
        rawClient.query(
          `INSERT INTO "ClientContact" (id, "organizationId", "clientId", name, "isPrimary", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'Not primary', false, now(), now())`,
          [orgId, clientId],
        ),
      ).resolves.toBeDefined();

      // Reconnected mid-test; the final reconnected client's own errors
      // are this callback's own responsibility to enforce (see
      // reconnectIsolatedRawClient's own doc comment).
      await endIsolatedRawClient(rawClient);
    });
  }, 30_000);

  it("8. every expected ordinary index is present, with no unrelated ones", async () => {
    await withIsolatedDb(55676, async (rawClient) => {
      const indexes = await rawClient.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'ClientContact'`);
      const names = indexes.rows.map((r) => r.indexname as string).sort();
      expect(names).toEqual(
        [
          "ClientContact_pkey",
          "ClientContact_organizationId_idx",
          "ClientContact_clientId_idx",
          "ClientContact_email_idx",
          "ClientContact_clientId_archivedAt_idx",
          "client_contact_one_active_primary",
        ].sort(),
      );
    });
  }, 30_000);
});
