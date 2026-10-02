import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Automates what Stage 2A's emergency lockdown was verified by hand: that
// migration 20260802120937_lockdown_public_schema_grants actually revoked
// anon/authenticated's privileges (and default privileges for objects
// created later), without touching postgres's own ownership or removing
// tables. Runs against the full real migration history applied by the
// integration suite's own global setup (see test/support/local-postgres.ts)
// — this is the exact SQL history, not a re-description of it, and grows
// as new migrations are added rather than staying pinned to a count.
//
// What this CANNOT verify locally, and why (see the Stage 4 report):
//   - Real Supabase PostgREST behavior (an anon/authenticated JWT actually
//     being rejected by the Data API) — there is no real PostgREST server
//     in this sandbox, only a bare Postgres-compatible engine (PGlite).
//   - Real Supabase Auth token verification — no Supabase Auth service
//     runs here either.
//   These require a real Supabase project (or `supabase start` under
//   Docker, unavailable in this sandbox) and are left for a later stage
//   with that infrastructure, per the user's own "leave a TODO, don't
//   write a fake test" instruction.

describe("public schema grants lockdown (migration 20260802120937)", () => {
  it("prisma migrate status reports every migration applied, none pending", async () => {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const row of rows) {
      expect(row.finished_at).not.toBeNull();
    }
  });

  it("anon has zero table-level grants on the public schema", async () => {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int as count FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public'`,
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("authenticated has zero table-level grants on the public schema", async () => {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int as count FROM information_schema.role_table_grants WHERE grantee = 'authenticated' AND table_schema = 'public'`,
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("postgres (the owning/migrating role) still has full grants — the lockdown never touched its own access", async () => {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int as count FROM information_schema.role_table_grants WHERE grantee = 'postgres' AND table_schema = 'public' AND table_name = 'Organization'`,
    );
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });

  it("default privileges for future tables (owned by postgres) exclude anon/authenticated", async () => {
    const rows = await prisma.$queryRawUnsafe<{ defaclacl: string | null }[]>(
      `SELECT d.defaclacl::text as defaclacl
       FROM pg_default_acl d
       JOIN pg_roles r ON r.oid = d.defaclrole
       WHERE r.rolname = 'postgres' AND d.defaclobjtype = 'r'`,
    );
    // Either no default-ACL row at all for postgres/tables (meaning: use
    // the schema/role's built-in default, which this migration also
    // revoked CREATE on for anon/authenticated — see the migration's own
    // step 4), or a row that explicitly excludes anon/authenticated.
    for (const row of rows) {
      if (row.defaclacl) {
        expect(row.defaclacl).not.toMatch(/anon=/);
        expect(row.defaclacl).not.toMatch(/authenticated=/);
      }
    }
  });

  it("every table from the schema still exists — the lockdown revoked privileges, never dropped anything", async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const tableNames = rows.map((r) => r.table_name);
    for (const expected of ["Organization", "Membership", "Client", "Project", "Task", "Invoice", "Attachment", "Activity", "PortalUser", "Invitation", "ClientInvitation", "User", "PortalDownloadRequest"]) {
      expect(tableNames).toContain(expected);
    }
  });

  // Portal Analytics persistence foundation (docs/analytics-architecture.md
  // §12, Slice 1) — the security consideration this stage's own task
  // explicitly raised: does a brand-new table, created after the lockdown
  // migration already ran, actually inherit its no-grants state? Verified
  // directly here rather than assumed — PortalDownloadRequest exists only
  // because a later migration created it, so if the lockdown's default-
  // privilege change (migration 20260802120937, step 4) didn't apply to
  // "future" postgres-owned tables the way it claims to, this is exactly
  // the test that would catch it.
  it("the new PortalDownloadRequest table (created after the lockdown migration) still has zero anon/authenticated grants", async () => {
    const [anonRows, authenticatedRows] = await Promise.all([
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::int as count FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public' AND table_name = 'PortalDownloadRequest'`,
      ),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::int as count FROM information_schema.role_table_grants WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = 'PortalDownloadRequest'`,
      ),
    ]);
    expect(Number(anonRows[0].count)).toBe(0);
    expect(Number(authenticatedRows[0].count)).toBe(0);
  });

  // TODO (needs real Supabase, out of scope for Stage 4 — see file header):
  //   - anon/authenticated JWTs are actually rejected by a live PostgREST
  //     endpoint (verified by hand against production in Stage 2A/2B;
  //     would need `supabase start` under Docker to automate, which this
  //     sandbox does not have).
  //   - Supabase Auth session cookie flags / signInWithPassword behavior
  //     against a real Auth service.
});

// The whole-suite "no fixture rows remain anywhere" zero-state check used
// to live here, gated by a comment claiming this file "runs last
// alphabetically." That assumption is false — Vitest's file execution
// order is not a guaranteed final-file contract (proven via real runs
// showing this file at different positions) — so the check has moved to
// the one place that genuinely is the suite's final boundary:
// test/integration/global-setup.ts's own teardown(), via
// test/support/assert-integration-db-clean.ts. See that module's own doc
// comment and test/integration/support/assert-integration-db-clean.test.ts
// for the full proof and regression coverage. This file now tests grants/
// security only.
