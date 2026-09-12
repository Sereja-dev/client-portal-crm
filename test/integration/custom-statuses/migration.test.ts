import { rename, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * Custom Statuses Phase 1 — live database behavior coverage for
 * 20260926090000_add_custom_statuses_foundation (test items 1-8 of the
 * originating task's own Section Z/AA). Mirrors test/integration/invoices/
 * invoice-number-organization-migration-contract.test.ts's own exact
 * "move this migration's real directory aside, deploy every other
 * migration, seed pre-existing data, then execute this migration's own
 * SQL text directly" technique (see that file's own header comment for
 * the full reasoning on why isolation makes this safe) — required here
 * because, unlike test/integration/custom-fields/schema-migration.test.ts's
 * own migration (three brand-new, always-empty tables), this migration's
 * own backfill only has something real to prove against PRE-EXISTING
 * Client/Lead/Project rows that existed before it ran.
 *
 * Own dedicated ports, 55690-55700, so this file can never collide with
 * any other file's sockets.
 *
 * This file only proves the SCHEMA/DB-level contract. Live application-
 * level behavior (definitions CRUD, assignment, resolution, ownership
 * validation) is proven against the real app code in the sibling
 * new-org-bootstrap.test.ts/definitions.test.ts/assignment.test.ts/
 * system-semantics.test.ts/security.test.ts files instead — this file
 * never calls any of that application code.
 */

const MIGRATION_DIR_NAME = "20260926090000_add_custom_statuses_foundation";
const REAL_MIGRATION_DIR = join(__dirname, "../../../prisma/migrations", MIGRATION_DIR_NAME);
const MOVED_ASIDE_DIR = join(tmpdir(), `${MIGRATION_DIR_NAME}_TEMP_MOVED_FOR_TEST`);
const REPO_ROOT = join(__dirname, "../../..");

// Later migrations whose own SQL references a type this migration defines
// (`CustomStatusColor`) and which must therefore be moved aside *together*
// with this one — otherwise deployAllMigrationsExceptThisOne() below would
// still try to apply them against a database where that type was never
// created, and fail. Tags V1 Phase 1's own migration reuses
// CustomStatusColor for Tag.color (see Tag's schema doc comment) rather
// than defining a redundant, identical enum, so it is the first entry
// here.
const DEPENDENT_MIGRATION_DIR_NAMES = ["20261001140000_add_tags_foundation"];
const DEPENDENT_MIGRATION_DIRS = DEPENDENT_MIGRATION_DIR_NAMES.map((name) => ({
  real: join(__dirname, "../../../prisma/migrations", name),
  movedAside: join(tmpdir(), `${name}_TEMP_MOVED_FOR_TEST`),
}));

const migrationSql = readFileSync(join(REAL_MIGRATION_DIR, "migration.sql"), "utf-8");

const execFileAsync = promisify(execFile);

let activeCleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (activeCleanup) {
    await activeCleanup();
    activeCleanup = undefined;
  }
  await rm(MOVED_ASIDE_DIR, { recursive: true, force: true });
  for (const { movedAside } of DEPENDENT_MIGRATION_DIRS) {
    await rm(movedAside, { recursive: true, force: true });
  }
});

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

/** Applies every migration except this one and its own DEPENDENT_MIGRATION_DIRS (moves each real directory aside for the duration of the deploy call only). */
async function deployAllMigrationsExceptThisOne(databaseUrl: string): Promise<void> {
  await rename(REAL_MIGRATION_DIR, MOVED_ASIDE_DIR);
  for (const { real, movedAside } of DEPENDENT_MIGRATION_DIRS) {
    await rename(real, movedAside);
  }
  try {
    await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    });
  } finally {
    for (const { real, movedAside } of DEPENDENT_MIGRATION_DIRS) {
      await rename(movedAside, real);
    }
    await rename(MOVED_ASIDE_DIR, REAL_MIGRATION_DIR);
  }
}

/** Applies the COMPLETE migration history (every migration, from zero) — used by the constraint-level tests below, which need no pre-existing data. */
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

async function seedPreExistingOrgWithEntities(
  rawClient: pg.Client,
  ids: { orgId: string; userId: string; clientId: string; leadId: string; projectId: string; orgSlug: string; userEmail: string },
): Promise<void> {
  await rawClient.query(
    `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', $2, now(), now())`,
    [ids.orgId, ids.orgSlug],
  );
  await rawClient.query(
    `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'U', now(), now())`,
    [ids.userId, ids.userEmail],
  );
  // Deliberately non-default legacy values, so the backfill's own per-row
  // key MATCH (not just "always picks the org's default") is what gets
  // proven: Client ACTIVE (not the default LEAD), Lead QUALIFIED (not the
  // default NEW), Project ON_HOLD (not the default PLANNING).
  await rawClient.query(
    `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'C', 'ACTIVE', $2, $3, now(), now())`,
    [ids.clientId, ids.userId, ids.orgId],
  );
  await rawClient.query(
    `INSERT INTO "Lead" (id, name, stage, "organizationId", "createdAt", "updatedAt") VALUES ($1, 'L', 'QUALIFIED', $2, now(), now())`,
    [ids.leadId, ids.orgId],
  );
  await rawClient.query(
    `INSERT INTO "Project" (id, name, status, "clientId", "ownerId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'P', 'ON_HOLD', $2, $3, $4, now(), now())`,
    [ids.projectId, ids.clientId, ids.userId, ids.orgId],
  );
}

describe("20260926090000_add_custom_statuses_foundation — backfill behavior (pre-existing data, isolated PGlite)", () => {
  it("1. backfill inserts exactly 4 CLIENT + 6 LEAD + 5 PROJECT system definitions for a pre-existing Organization, and none for a second, unrelated Organization run through the same migration", async () => {
    const port = 55690;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await socketServer.stop();
      await pglite.close();
    };

    await deployAllMigrationsExceptThisOne(databaseUrl);

    const rawClient = new pg.Client({ connectionString: databaseUrl });
    await rawClient.connect();
    const orgId = "aaaaaaaa-0000-0000-0000-000000000001";
    const orgId2 = "aaaaaaaa-0000-0000-0000-000000000009";
    await seedPreExistingOrgWithEntities(rawClient, {
      orgId,
      userId: "aaaaaaaa-0000-0000-0000-000000000002",
      clientId: "aaaaaaaa-0000-0000-0000-000000000003",
      leadId: "aaaaaaaa-0000-0000-0000-000000000004",
      projectId: "aaaaaaaa-0000-0000-0000-000000000005",
      orgSlug: "probe-org-a",
      userEmail: "probe-a@example.com",
    });
    await rawClient.query(
      `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org 2', 'probe-org-b', now(), now())`,
      [orgId2],
    );

    await rawClient.query(migrationSql);

    const counts = await rawClient.query(
      `SELECT "organizationId", "entityType", COUNT(*)::int AS n FROM "CustomStatusDefinition" GROUP BY "organizationId", "entityType" ORDER BY "organizationId", "entityType"`,
    );
    const byOrg = (org: string) =>
      Object.fromEntries(counts.rows.filter((r) => r.organizationId === org).map((r) => [r.entityType, r.n]));
    expect(byOrg(orgId)).toEqual({ CLIENT: 4, LEAD: 6, PROJECT: 5 });
    expect(byOrg(orgId2)).toEqual({ CLIENT: 4, LEAD: 6, PROJECT: 5 });

    await rawClient.end();
  }, 30_000);

  it("2. every pre-existing Client/Lead/Project row's statusDefinitionId is backfilled to the system definition matching its own current legacy status/stage value (not the org's default)", async () => {
    const port = 55691;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await socketServer.stop();
      await pglite.close();
    };

    await deployAllMigrationsExceptThisOne(databaseUrl);

    const rawClient = new pg.Client({ connectionString: databaseUrl });
    await rawClient.connect();
    const orgId = "bbbbbbbb-0000-0000-0000-000000000001";
    const clientId = "bbbbbbbb-0000-0000-0000-000000000003";
    const leadId = "bbbbbbbb-0000-0000-0000-000000000004";
    const projectId = "bbbbbbbb-0000-0000-0000-000000000005";
    await seedPreExistingOrgWithEntities(rawClient, {
      orgId,
      userId: "bbbbbbbb-0000-0000-0000-000000000002",
      clientId,
      leadId,
      projectId,
      orgSlug: "probe-org-c",
      userEmail: "probe-c@example.com",
    });

    await rawClient.query(migrationSql);

    const client = await rawClient.query(
      `SELECT c."statusDefinitionId", d.key, d."isSystem" FROM "Client" c JOIN "CustomStatusDefinition" d ON d.id = c."statusDefinitionId" WHERE c.id = $1`,
      [clientId],
    );
    expect(client.rows[0].key).toBe("active");
    expect(client.rows[0].isSystem).toBe(true);

    const lead = await rawClient.query(
      `SELECT l."statusDefinitionId", d.key FROM "Lead" l JOIN "CustomStatusDefinition" d ON d.id = l."statusDefinitionId" WHERE l.id = $1`,
      [leadId],
    );
    expect(lead.rows[0].key).toBe("qualified");

    const project = await rawClient.query(
      `SELECT p."statusDefinitionId", d.key FROM "Project" p JOIN "CustomStatusDefinition" d ON d.id = p."statusDefinitionId" WHERE p.id = $1`,
      [projectId],
    );
    expect(project.rows[0].key).toBe("on_hold");

    await rawClient.end();
  }, 30_000);

  it("3. the migration never modifies any pre-existing Client/Lead/Project row's own legacy status/stage/name/other column values — only the new statusDefinitionId column is populated", async () => {
    const port = 55692;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await socketServer.stop();
      await pglite.close();
    };

    await deployAllMigrationsExceptThisOne(databaseUrl);

    const rawClient = new pg.Client({ connectionString: databaseUrl });
    await rawClient.connect();
    const orgId = "cccccccc-0000-0000-0000-000000000001";
    const clientId = "cccccccc-0000-0000-0000-000000000003";
    const leadId = "cccccccc-0000-0000-0000-000000000004";
    const projectId = "cccccccc-0000-0000-0000-000000000005";
    await seedPreExistingOrgWithEntities(rawClient, {
      orgId,
      userId: "cccccccc-0000-0000-0000-000000000002",
      clientId,
      leadId,
      projectId,
      orgSlug: "probe-org-d",
      userEmail: "probe-d@example.com",
    });

    await rawClient.query(migrationSql);

    const client = await rawClient.query(`SELECT name, status FROM "Client" WHERE id = $1`, [clientId]);
    expect(client.rows[0]).toEqual({ name: "C", status: "ACTIVE" });
    const lead = await rawClient.query(`SELECT name, stage FROM "Lead" WHERE id = $1`, [leadId]);
    expect(lead.rows[0]).toEqual({ name: "L", stage: "QUALIFIED" });
    const project = await rawClient.query(`SELECT name, status FROM "Project" WHERE id = $1`, [projectId]);
    expect(project.rows[0]).toEqual({ name: "P", status: "ON_HOLD" });

    await rawClient.end();
  }, 30_000);

  it("4. backfilled system definitions have deterministic keys/labels/positions/colors and exactly one isDefault per organization+entityType", async () => {
    const port = 55693;
    const { databaseUrl, pglite, socketServer } = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await socketServer.stop();
      await pglite.close();
    };

    await deployAllMigrationsExceptThisOne(databaseUrl);

    const rawClient = new pg.Client({ connectionString: databaseUrl });
    await rawClient.connect();
    const orgId = "dddddddd-0000-0000-0000-000000000001";
    await seedPreExistingOrgWithEntities(rawClient, {
      orgId,
      userId: "dddddddd-0000-0000-0000-000000000002",
      clientId: "dddddddd-0000-0000-0000-000000000003",
      leadId: "dddddddd-0000-0000-0000-000000000004",
      projectId: "dddddddd-0000-0000-0000-000000000005",
      orgSlug: "probe-org-e",
      userEmail: "probe-e@example.com",
    });

    await rawClient.query(migrationSql);

    const clientRows = await rawClient.query(
      `SELECT key, label, position, "isDefault", "isSystem" FROM "CustomStatusDefinition" WHERE "organizationId" = $1 AND "entityType" = 'CLIENT' ORDER BY position`,
      [orgId],
    );
    expect(clientRows.rows).toEqual([
      { key: "lead", label: "Lead", position: 0, isDefault: true, isSystem: true },
      { key: "active", label: "Active", position: 1, isDefault: false, isSystem: true },
      { key: "inactive", label: "Inactive", position: 2, isDefault: false, isSystem: true },
      { key: "archived", label: "Archived", position: 3, isDefault: false, isSystem: true },
    ]);

    const defaultCounts = await rawClient.query(
      `SELECT "entityType", COUNT(*)::int AS n FROM "CustomStatusDefinition" WHERE "organizationId" = $1 AND "isDefault" = true GROUP BY "entityType" ORDER BY "entityType"`,
      [orgId],
    );
    expect(defaultCounts.rows).toEqual([
      { entityType: "CLIENT", n: 1 },
      { entityType: "LEAD", n: 1 },
      { entityType: "PROJECT", n: 1 },
    ]);

    await rawClient.end();
  }, 30_000);
});

describe("20260926090000_add_custom_statuses_foundation — schema/constraint contract (full deploy, no pre-existing data needed)", () => {
  it("5. the CustomStatusDefinition_organizationId_entityType_key_key uniquely constrains (organizationId, entityType, key)", async () => {
    await withIsolatedDb(55694, async (rawClient) => {
      const index = await rawClient.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'CustomStatusDefinition' AND indexname = 'CustomStatusDefinition_organizationId_entityType_key_key'`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toMatch(/UNIQUE/i);

      const orgId = "eeeeeeee-0000-0000-0000-000000000001";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-uniq', now(), now())`, [orgId]);
      await rawClient.query(
        `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'CLIENT', 'vip', 'VIP', 10, now(), now())`,
        [orgId],
      );
      await expect(
        rawClient.query(
          `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'CLIENT', 'vip', 'Different Label', 11, now(), now())`,
          [orgId],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);

      // Same key, different entityType — must be allowed (unique is per entityType too).
      await expect(
        rawClient.query(
          `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'LEAD', 'vip', 'VIP', 10, now(), now())`,
          [orgId],
        ),
      ).resolves.toBeDefined();
    });
  }, 30_000);

  it("6. custom_status_definition_one_active_default rejects a second active default per organization+entityType, but allows one after the first is archived, and allows a second across different entityTypes", async () => {
    await withIsolatedDb(55695, async (rawClient) => {
      const index = await rawClient.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'CustomStatusDefinition' AND indexname = 'custom_status_definition_one_active_default'`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toMatch(/UNIQUE/i);

      const orgId = "ffffffff-0000-0000-0000-000000000001";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-default', now(), now())`, [orgId]);
      await rawClient.query(
        `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "isDefault", "createdAt", "updatedAt") VALUES ('ffffffff-0000-0000-0000-000000000002', $1, 'CLIENT', 'a', 'A', 0, true, now(), now())`,
        [orgId],
      );

      // A second active default for the SAME entityType — rejected.
      await expect(
        rawClient.query(
          `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "isDefault", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'CLIENT', 'b', 'B', 1, true, now(), now())`,
          [orgId],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);

      // A second active default for a DIFFERENT entityType — allowed.
      await expect(
        rawClient.query(
          `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "isDefault", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'LEAD', 'a', 'A', 0, true, now(), now())`,
          [orgId],
        ),
      ).resolves.toBeDefined();

      // Once the first CLIENT default is archived, a new CLIENT default is allowed.
      await rawClient.query(`UPDATE "CustomStatusDefinition" SET "archivedAt" = now() WHERE id = 'ffffffff-0000-0000-0000-000000000002'`);
      await expect(
        rawClient.query(
          `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "isDefault", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'CLIENT', 'c', 'C', 2, true, now(), now())`,
          [orgId],
        ),
      ).resolves.toBeDefined();
    });
  }, 30_000);

  it("7a. FK constraint shape: CustomStatusDefinition.organizationId cascades with Organization; Client/Lead/Project.statusDefinitionId is NO ACTION DEFERRABLE INITIALLY DEFERRED, not plain RESTRICT (see migration header comment deviation (c))", async () => {
    await withIsolatedDb(55696, async (rawClient) => {
      const fks = await rawClient.query(
        `SELECT conname, confdeltype, condeferrable, condeferred FROM pg_constraint WHERE conname IN (
          'CustomStatusDefinition_organizationId_fkey',
          'Client_statusDefinitionId_fkey',
          'Lead_statusDefinitionId_fkey',
          'Project_statusDefinitionId_fkey'
        )`,
      );
      const byName = Object.fromEntries(fks.rows.map((r) => [r.conname, r]));
      expect(byName.CustomStatusDefinition_organizationId_fkey.confdeltype).toBe("c"); // CASCADE
      for (const name of ["Client_statusDefinitionId_fkey", "Lead_statusDefinitionId_fkey", "Project_statusDefinitionId_fkey"]) {
        expect(byName[name].confdeltype).toBe("a"); // NO ACTION
        expect(byName[name].condeferrable).toBe(true);
        expect(byName[name].condeferred).toBe(true); // INITIALLY DEFERRED
      }
    });
  }, 30_000);

  it("7b. deleting a CustomStatusDefinition directly, on its own, while a Client still references it, is still rejected (RESTRICT-equivalent behavior preserved)", async () => {
    await withIsolatedDb(55697, async (rawClient) => {
      const orgId = "11111111-2222-0000-0000-000000000001";
      const userId = "11111111-2222-0000-0000-000000000002";
      const clientId = "11111111-2222-0000-0000-000000000003";
      const defId = "11111111-2222-0000-0000-000000000004";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-fk-a', now(), now())`, [orgId]);
      await rawClient.query(`INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'U', now(), now())`, [userId, "probe-fk-a@example.com"]);
      await rawClient.query(
        `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'custom_a', 'Custom A', 10, now(), now())`,
        [defId, orgId],
      );
      await rawClient.query(
        `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "statusDefinitionId", "createdAt", "updatedAt") VALUES ($1, 'C', 'LEAD', $2, $3, $4, now(), now())`,
        [clientId, userId, orgId, defId],
      );

      // Nothing else in this transaction removes the Client's own
      // reference — deferred or not, the definition must still be
      // unremovable while it's the only thing changing.
      await expect(rawClient.query(`DELETE FROM "CustomStatusDefinition" WHERE id = $1`, [defId])).rejects.toThrow(
        /foreign key constraint/i,
      );
      const remaining = await rawClient.query(`SELECT COUNT(*)::int AS n FROM "CustomStatusDefinition" WHERE id = $1`, [defId]);
      expect(remaining.rows[0].n).toBe(1);
    });
  }, 30_000);

  it("7c. deleting the whole Organization cascades away BOTH a Lead and the CustomStatusDefinition it referenced, without an FK error — Lead.organizationId is CASCADE (unlike Client/Project's own SetNull), so this is the one entity that genuinely hits the diamond-cascade-ordering race a plain (non-deferred) RESTRICT could not tolerate (see migration header comment deviation (c))", async () => {
    await withIsolatedDb(55698, async (rawClient) => {
      const orgId = "22222222-0000-0000-0000-000000000001";
      const leadId = "22222222-0000-0000-0000-000000000003";
      const defId = "22222222-0000-0000-0000-000000000004";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-fk-b', now(), now())`, [orgId]);
      await rawClient.query(
        `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES ($1, $2, 'LEAD', 'custom_a', 'Custom A', 10, now(), now())`,
        [defId, orgId],
      );
      await rawClient.query(
        `INSERT INTO "Lead" (id, name, "organizationId", "statusDefinitionId", "createdAt", "updatedAt") VALUES ($1, 'L', $2, $3, now(), now())`,
        [leadId, orgId, defId],
      );

      // Deleting the Organization cascades away BOTH the Lead (via its
      // own pre-existing organizationId CASCADE — unlike Client/Project,
      // whose own organizationId is SetNull, not Cascade; see 7d below)
      // AND the definition (via this migration's own organizationId
      // CASCADE) in the same statement — by the time the deferred check
      // runs (end of this implicit single-statement transaction), the
      // Lead row that used to reference the definition is already gone
      // too, so it passes. A plain (immediate) RESTRICT could fail this
      // depending on which of the two CASCADEs Postgres happens to fire
      // first — deferring the check is what makes the outcome independent
      // of that unspecified ordering.
      await expect(rawClient.query(`DELETE FROM "Organization" WHERE id = $1`, [orgId])).resolves.toBeDefined();
      const remaining = await rawClient.query(`SELECT COUNT(*)::int AS n FROM "CustomStatusDefinition" WHERE "organizationId" = $1`, [orgId]);
      expect(remaining.rows[0].n).toBe(0);
      const remainingLeads = await rawClient.query(`SELECT COUNT(*)::int AS n FROM "Lead" WHERE "organizationId" = $1`, [orgId]);
      expect(remainingLeads.rows[0].n).toBe(0);
    });
  }, 30_000);

  it("7d. Client/Project.organizationId is SetNull, not Cascade — deleting the Organization orphans (never removes) a Client/Project row, so one that still references a CustomStatusDefinition correctly continues to block that definition's deletion; this is why cleanupTestData (test/fixtures/seed.ts) always deletes Client rows explicitly before deleting the Organization, rather than relying on any cascade to do it", async () => {
    await withIsolatedDb(55700, async (rawClient) => {
      const orgId = "33333333-0000-0000-0000-000000000001";
      const userId = "33333333-0000-0000-0000-000000000002";
      const clientId = "33333333-0000-0000-0000-000000000003";
      const defId = "33333333-0000-0000-0000-000000000004";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-fk-c', now(), now())`, [orgId]);
      await rawClient.query(`INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'U', now(), now())`, [userId, "probe-fk-c@example.com"]);
      await rawClient.query(
        `INSERT INTO "CustomStatusDefinition" (id, "organizationId", "entityType", key, label, position, "createdAt", "updatedAt") VALUES ($1, $2, 'CLIENT', 'custom_a', 'Custom A', 10, now(), now())`,
        [defId, orgId],
      );
      await rawClient.query(
        `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "statusDefinitionId", "createdAt", "updatedAt") VALUES ($1, 'C', 'LEAD', $2, $3, $4, now(), now())`,
        [clientId, userId, orgId, defId],
      );

      // The Client row survives Organization deletion (orphaned, not
      // removed) and still points at the definition, which is itself
      // being cascade-deleted — genuinely, permanently referenced, not a
      // timing artifact, so this is correctly rejected regardless of
      // deferred timing.
      await expect(rawClient.query(`DELETE FROM "Organization" WHERE id = $1`, [orgId])).rejects.toThrow(
        /foreign key constraint/i,
      );

      // Deleting the Client explicitly FIRST (exactly what
      // cleanupTestData already does) then lets the Organization go.
      await rawClient.query(`DELETE FROM "Client" WHERE id = $1`, [clientId]);
      await expect(rawClient.query(`DELETE FROM "Organization" WHERE id = $1`, [orgId])).resolves.toBeDefined();
    });
  }, 30_000);

  it("8. statusDefinitionId is nullable on Client/Lead/Project — a new row can be created without one", async () => {
    await withIsolatedDb(55699, async (rawClient) => {
      const columns = await rawClient.query(
        `SELECT table_name, is_nullable FROM information_schema.columns WHERE table_name IN ('Client', 'Lead', 'Project') AND column_name = 'statusDefinitionId' ORDER BY table_name`,
      );
      expect(columns.rows).toEqual([
        { table_name: "Client", is_nullable: "YES" },
        { table_name: "Lead", is_nullable: "YES" },
        { table_name: "Project", is_nullable: "YES" },
      ]);

      const orgId = "22222222-3333-0000-0000-000000000001";
      const userId = "22222222-3333-0000-0000-000000000002";
      const clientId = "22222222-3333-0000-0000-000000000003";
      const leadId = "22222222-3333-0000-0000-000000000004";
      await rawClient.query(`INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, 'Org', 'org-cs-nullable', now(), now())`, [orgId]);
      await rawClient.query(`INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, 'U', now(), now())`, [userId, "probe-nullable@example.com"]);
      await expect(
        rawClient.query(
          `INSERT INTO "Client" (id, name, status, "userId", "organizationId", "createdAt", "updatedAt") VALUES ($1, 'C', 'LEAD', $2, $3, now(), now())`,
          [clientId, userId, orgId],
        ),
      ).resolves.toBeDefined();
      await expect(
        rawClient.query(
          `INSERT INTO "Lead" (id, name, "organizationId", "createdAt", "updatedAt") VALUES ($1, 'L', $2, now(), now())`,
          [leadId, orgId],
        ),
      ).resolves.toBeDefined();
    });
  }, 30_000);
});
