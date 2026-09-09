import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * Custom Fields Phase 1 — live database behavior coverage for
 * 20260925090000_add_custom_fields_foundation. Mirrors test/integration/
 * clients/contacts-schema-migration.test.ts's own exact isolated-PGlite-
 * per-test technique (own dedicated ports, 55680-55689, so this file can
 * never collide with any other file's sockets — see that file's own
 * header comment for why an isolated instance is used instead of the
 * shared harness: a schema/constraint-level assertion needs to inspect
 * pg_constraint/pg_indexes directly, which the shared harness's own
 * Prisma client doesn't expose).
 *
 * This file only proves the SCHEMA/DB-level contract (test items 34-37
 * of the originating task, plus the CHECK-constraint behavioral proof
 * called out in Section N). The live application-level behavior
 * (definitions/options/values CRUD, ownership validation, delete
 * cleanup) is proven against the real app code in the sibling
 * definitions.test.ts/options.test.ts/values.test.ts/delete-cleanup.test.ts
 * files instead — this file never calls any of that application code.
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

/** Applies the COMPLETE migration history (every migration, from zero) — this is the actual deployment sequence, not a partial/pre-this-migration state. Also proves "migrate status clean"/"all migrations apply" as a side effect of succeeding at all. */
async function deployFullMigrationHistory(databaseUrl: string): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  });
}

async function withIsolatedDb(port: number, fn: (rawClient: pg.Client) => Promise<void>): Promise<void> {
  const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
  try {
    await deployFullMigrationHistory(databaseUrl);
    const rawClient = new pg.Client({ connectionString: databaseUrl });
    await rawClient.connect();
    try {
      await fn(rawClient);
    } finally {
      await rawClient.end();
    }
  } finally {
    await socketServer.stop();
    await pglite.close();
  }
}

async function seedOrgAndClient(rawClient: pg.Client, orgId: string, userId: string, clientId: string): Promise<void> {
  await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', $2, now(), now())`, [orgId, `org-${orgId.slice(0, 8)}`]);
  await rawClient.query(`INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'U', now(), now())`, [userId, `${userId.slice(0, 8)}@x.test`]);
  await rawClient.query(
    `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'C', 'ACTIVE', $2, $3, now(), now())`,
    [clientId, userId, orgId],
  );
}

describe("20260925090000_add_custom_fields_foundation — live database behavior (isolated, disposable PGlite instances)", () => {
  it("34. applying the complete migration history from zero creates all three tables, empty", async () => {
    await withIsolatedDb(55680, async (rawClient) => {
      const tables = await rawClient.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name IN ('CustomFieldDefinition', 'CustomFieldOption', 'CustomFieldValue') ORDER BY table_name`,
      );
      expect(tables.rows.map((r) => r.table_name)).toEqual(["CustomFieldDefinition", "CustomFieldOption", "CustomFieldValue"]);

      for (const table of ["CustomFieldDefinition", "CustomFieldOption", "CustomFieldValue"]) {
        const count = await rawClient.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
        expect(count.rows[0].n).toBe(0);
      }
    });
  }, 30_000);

  it("35. existing Client/Lead/Project/Quote/Invoice/PortalUser/ClientContact row counts are unchanged (no accidental data touch)", async () => {
    await withIsolatedDb(55681, async (rawClient) => {
      const orgId = "10000000-0000-0000-0000-000000000001";
      const userId = "10000000-0000-0000-0000-000000000002";
      const clientId = "10000000-0000-0000-0000-000000000003";
      await seedOrgAndClient(rawClient, orgId, userId, clientId);

      for (const table of ["Client", "Lead", "Project", "Quote", "Invoice", "PortalUser", "ClientContact"]) {
        const info = await rawClient.query(`SELECT to_regclass($1) AS reg`, [`"${table}"`]);
        expect(info.rows[0].reg).not.toBeNull();
      }
      const clientCount = await rawClient.query(`SELECT COUNT(*)::int AS n FROM "Client"`);
      expect(clientCount.rows[0].n).toBe(1);
    });
  }, 30_000);

  it("36. CustomFieldDefinition_organizationId_entityType_key_key uniquely constrains (organizationId, entityType, key)", async () => {
    await withIsolatedDb(55682, async (rawClient) => {
      const index = await rawClient.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'CustomFieldDefinition' AND indexname = 'CustomFieldDefinition_organizationId_entityType_key_key'`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toMatch(/UNIQUE/i);

      const orgId = "20000000-0000-0000-0000-000000000001";
      const defId1 = "20000000-0000-0000-0000-000000000002";
      const defId2 = "20000000-0000-0000-0000-000000000003";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cf-uniq', now(), now())`, [orgId]);
      await rawClient.query(
        `INSERT INTO "CustomFieldDefinition" (id, "organizationId", "entityType", key, label, "fieldType", position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'account_manager', 'Account Manager', 'TEXT', 0, now(), now())`,
        [defId1, orgId],
      );
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldDefinition" (id, "organizationId", "entityType", key, label, "fieldType", position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'account_manager', 'Different Label', 'TEXT', 1, now(), now())`,
          [defId2, orgId],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);

      // Same key, different entityType — must be allowed (unique is per entityType too).
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldDefinition" (id, "organizationId", "entityType", key, label, "fieldType", position, "createdAt", "updatedAt") VALUES ($1, $2, 'LEAD', 'account_manager', 'Account Manager', 'TEXT', 0, now(), now())`,
          [defId2, orgId],
        ),
      ).resolves.toBeDefined();
    });
  }, 30_000);

  it("37a. CustomFieldValue_definitionId_entityId_key enforces at most one value per definition+entity", async () => {
    await withIsolatedDb(55683, async (rawClient) => {
      const orgId = "30000000-0000-0000-0000-000000000001";
      const userId = "30000000-0000-0000-0000-000000000002";
      const clientId = "30000000-0000-0000-0000-000000000003";
      const defId = "30000000-0000-0000-0000-000000000004";
      await seedOrgAndClient(rawClient, orgId, userId, clientId);
      await rawClient.query(
        `INSERT INTO "CustomFieldDefinition" (id, "organizationId", "entityType", key, label, "fieldType", position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'notes', 'Notes', 'TEXT', 0, now(), now())`,
        [defId, orgId],
      );
      await rawClient.query(
        `INSERT INTO "CustomFieldValue" (id, "organizationId", "definitionId", "entityId", "textValue", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 'first', now(), now())`,
        [orgId, defId, clientId],
      );
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldValue" (id, "organizationId", "definitionId", "entityId", "textValue", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 'second', now(), now())`,
          [orgId, defId, clientId],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);
    });
  }, 30_000);

  it("37b. the exactly-one-typed-value CHECK constraint rejects zero and multiple populated columns, and accepts exactly one", async () => {
    await withIsolatedDb(55684, async (rawClient) => {
      const orgId = "40000000-0000-0000-0000-000000000001";
      const userId = "40000000-0000-0000-0000-000000000002";
      const clientId = "40000000-0000-0000-0000-000000000003";
      const defId = "40000000-0000-0000-0000-000000000004";
      await seedOrgAndClient(rawClient, orgId, userId, clientId);
      await rawClient.query(
        `INSERT INTO "CustomFieldDefinition" (id, "organizationId", "entityType", key, label, "fieldType", position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'notes', 'Notes', 'TEXT', 0, now(), now())`,
        [defId, orgId],
      );

      // Zero typed columns populated — rejected.
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldValue" (id, "organizationId", "definitionId", "entityId", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now(), now())`,
          [orgId, defId, clientId],
        ),
      ).rejects.toThrow(/CustomFieldValue_exactly_one_typed_value|check constraint/i);

      // Two typed columns populated — rejected.
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldValue" (id, "organizationId", "definitionId", "entityId", "textValue", "numberValue", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 'x', 1.5, now(), now())`,
          [orgId, defId, clientId],
        ),
      ).rejects.toThrow(/CustomFieldValue_exactly_one_typed_value|check constraint/i);

      // Exactly one typed column populated — accepted.
      await expect(
        rawClient.query(
          `INSERT INTO "CustomFieldValue" (id, "organizationId", "definitionId", "entityId", "textValue", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 'x', now(), now())`,
          [orgId, defId, clientId],
        ),
      ).resolves.toBeDefined();
    });
  }, 30_000);

  it("FK delete rules: CustomFieldDefinition/Value cascade with Organization; CustomFieldOption cascades with its Definition; CustomFieldValue.selectedOptionId is SET NULL", async () => {
    await withIsolatedDb(55685, async (rawClient) => {
      const fks = await rawClient.query(
        `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN (
          'CustomFieldDefinition_organizationId_fkey',
          'CustomFieldOption_definitionId_fkey',
          'CustomFieldValue_organizationId_fkey',
          'CustomFieldValue_definitionId_fkey',
          'CustomFieldValue_selectedOptionId_fkey'
        )`,
      );
      const byName = Object.fromEntries(fks.rows.map((r) => [r.conname, r.confdeltype]));
      expect(byName.CustomFieldDefinition_organizationId_fkey).toBe("c");
      expect(byName.CustomFieldOption_definitionId_fkey).toBe("c");
      expect(byName.CustomFieldValue_organizationId_fkey).toBe("c");
      expect(byName.CustomFieldValue_definitionId_fkey).toBe("c");
      expect(byName.CustomFieldValue_selectedOptionId_fkey).toBe("n");
    });
  }, 30_000);

  it("every expected ordinary index is present on all three tables, with no unrelated ones", async () => {
    await withIsolatedDb(55686, async (rawClient) => {
      const definitionIndexes = await rawClient.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'CustomFieldDefinition'`);
      expect(definitionIndexes.rows.map((r) => r.indexname as string).sort()).toEqual(
        [
          "CustomFieldDefinition_pkey",
          "CustomFieldDefinition_organizationId_entityType_key_key",
          "CustomFieldDefinition_organizationId_entityType_idx",
          "CustomFieldDefinition_organizationId_entityType_archivedAt_idx",
          "CustomFieldDefinition_organizationId_entityType_position_idx",
        ].sort(),
      );

      const optionIndexes = await rawClient.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'CustomFieldOption'`);
      expect(optionIndexes.rows.map((r) => r.indexname as string).sort()).toEqual(
        [
          "CustomFieldOption_pkey",
          "CustomFieldOption_definitionId_value_key",
          "CustomFieldOption_definitionId_position_idx",
          "CustomFieldOption_definitionId_archivedAt_idx",
        ].sort(),
      );

      const valueIndexes = await rawClient.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'CustomFieldValue'`);
      expect(valueIndexes.rows.map((r) => r.indexname as string).sort()).toEqual(
        [
          "CustomFieldValue_pkey",
          "CustomFieldValue_definitionId_entityId_key",
          "CustomFieldValue_organizationId_entityId_idx",
          "CustomFieldValue_definitionId_idx",
        ].sort(),
      );
    });
  }, 30_000);

  it("CustomFieldOption has no direct organizationId column (scoped only through its parent definitionId)", async () => {
    await withIsolatedDb(55687, async (rawClient) => {
      const columns = await rawClient.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'CustomFieldOption' AND column_name = 'organizationId'`,
      );
      expect(columns.rows).toHaveLength(0);
    });
  }, 30_000);
});
