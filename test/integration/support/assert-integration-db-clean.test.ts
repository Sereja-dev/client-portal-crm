import { describe, expect, it } from "vitest";
import pg from "pg";
import { withIsolatedDatabase } from "../../support/isolated-postgres";
import { assertIntegrationDbClean, IntegrationDbNotCleanError } from "../../support/assert-integration-db-clean";

/**
 * Grants whole-suite final verifier (narrow test-architecture fix) —
 * dedicated regression coverage for test/support/assert-integration-db-
 * clean.ts, proving it actually detects residue (not merely source-wired
 * into global teardown — see grants-final-verifier-architecture.test.ts
 * for that separate check) and that its error-combination semantics hold.
 *
 * Uses the existing isolated-PGlite harness (test/support/isolated-
 * postgres.ts) — a real, disposable Postgres engine with the complete
 * migration history applied, entirely separate from the shared canonical
 * harness grants.test.ts itself uses — so inserting/deleting rows here
 * can never interact with, or be interfered by, any other integration
 * file's own fixtures.
 *
 * Own dedicated port (55750), independent of every other isolated/
 * shared-harness test file.
 */

const REPO_ROOT = `${__dirname}/../../..`;
const PORT = 55750;

describe("assertIntegrationDbClean", () => {
  it("A. clean database: resolves quietly", async () => {
    await withIsolatedDatabase(PORT, REPO_ROOT, async (_rawClient, databaseUrl) => {
      await expect(assertIntegrationDbClean(databaseUrl)).resolves.toBeUndefined();
    });
  });

  it("B/C. a deliberate counted-table leak is detected, named, and counted — then clears once deleted", async () => {
    await withIsolatedDatabase(PORT + 1, REPO_ROOT, async (rawClient, databaseUrl) => {
      await rawClient.query(
        `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'Grants Final-Verifier Leak Co', 'grants-final-verifier-leak-co', now(), now())`,
      );

      let caught: unknown;
      try {
        await assertIntegrationDbClean(databaseUrl);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(IntegrationDbNotCleanError);
      const error = caught as IntegrationDbNotCleanError;
      expect(error.message).toMatch(/Integration DB not clean: Organization=1/);
      expect(error.residue).toEqual([{ table: "Organization", count: 1 }]);
      expect(error.message).toMatch(/Grants Final-Verifier Leak Co/);

      await rawClient.query(`DELETE FROM "Organization" WHERE slug = 'grants-final-verifier-leak-co'`);

      await expect(assertIntegrationDbClean(databaseUrl)).resolves.toBeUndefined();
    });
  });

  it("D. a connect failure surfaces as the real underlying error, not a false residue report", async () => {
    // No server is listening here — an isolated database was never
    // started on this port for this test.
    const unreachableUrl = "postgresql://postgres@127.0.0.1:55759/postgres";
    await expect(assertIntegrationDbClean(unreachableUrl)).rejects.not.toBeInstanceOf(IntegrationDbNotCleanError);
  });

  it("E. a client.end() failure never masks a real residue error — both are preserved", async () => {
    await withIsolatedDatabase(PORT + 2, REPO_ROOT, async (rawClient, databaseUrl) => {
      await rawClient.query(
        `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'Grants Final-Verifier End-Failure Co', 'grants-final-verifier-end-failure-co', now(), now())`,
      );

      // Genuinely ends the real connection first (so no socket is ever
      // left orphaned/un-listened-to once this test's isolated database
      // tears down), then reports failure anyway — simulating "end()
      // itself reported an error" without leaking a live connection.
      const originalEnd: (this: pg.Client) => Promise<void> = pg.Client.prototype.end;
      pg.Client.prototype.end = function syntheticFailingEnd(this: pg.Client) {
        return originalEnd
          .call(this)
          .catch(() => undefined)
          .then(() => Promise.reject(new Error("SYNTHETIC_END_FAILURE")));
      } as typeof pg.Client.prototype.end;

      let caught: unknown;
      try {
        await assertIntegrationDbClean(databaseUrl);
      } catch (err) {
        caught = err;
      } finally {
        pg.Client.prototype.end = originalEnd;
      }

      expect(caught).toBeInstanceOf(AggregateError);
      const aggregate = caught as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect(aggregate.errors[0]).toBeInstanceOf(IntegrationDbNotCleanError);
      expect(String(aggregate.errors[1])).toMatch(/SYNTHETIC_END_FAILURE/);
      expect(aggregate.message).toMatch(/Integration DB not clean: Organization=1/);

      await rawClient.query(`DELETE FROM "Organization" WHERE slug = 'grants-final-verifier-end-failure-co'`);
      await expect(assertIntegrationDbClean(databaseUrl)).resolves.toBeUndefined();
    });
  });
});
