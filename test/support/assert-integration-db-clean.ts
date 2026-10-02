import pg from "pg";

/**
 * Grants whole-suite final verifier (narrow test-architecture fix) — the
 * suite-global "no fixture rows remain anywhere" check used to live inside
 * test/integration/security/grants.test.ts, gated by a comment claiming
 * that file "runs last alphabetically." That assumption is false: Vitest's
 * file execution order is not a guaranteed final-file contract (proven via
 * real runs showing grants.test.ts at different positions), so the check
 * could silently stop observing anything if some other file's own leak
 * happened to land after it instead of before.
 *
 * The actual guaranteed final boundary — proven empirically (287/287 files,
 * 2979/2979 tests, two consecutive clean runs; every worker file's own
 * `afterAll` recorded complete strictly before global teardown's own entry
 * point, in a process whose PID never matches any worker's) — is
 * test/integration/global-setup.ts's own `teardown()`, at its very start,
 * before `stopTestDatabase()` tears the shared PGlite engine down. This
 * module is the dedicated, narrowly-scoped check meant to be called from
 * exactly that point — see this repo's own grants-final-verifier audit
 * report for the full proof.
 *
 * Deliberately a raw `pg.Client`, never `@/lib/prisma`: `teardown()` runs
 * in Vitest's main process, which never has the worker-only `DATABASE_URL`/
 * `PGLITE_TEST_DB` env (those are set per-worker by
 * test/integration/setup-env.ts's own `setupFiles`) — importing the
 * Product Prisma facade here would route through its real-Postgres
 * construction path instead of the PGlite test facade. A short-lived raw
 * client built from the caller-supplied `databaseUrl` (the same
 * `TEST_DATABASE_URL` constant test/support/local-postgres.ts already
 * exports) has no such dependency.
 */

/**
 * Exactly the ten models the original whole-suite check counted — the
 * shared root-identity fixtures (`User`, `Organization`) plus the models
 * NOT fully reachable by cascading from `Organization` alone: `Client` is
 * `onDelete: SetNull` (not `Cascade`) from `Organization`, and `PortalUser`
 * cascades from `Client`, not `Organization`, so both must be counted
 * directly. The remaining six (`Membership`, `Invitation`,
 * `ClientInvitation`, `Attachment`, `Activity`, `PortalDownloadRequest`) do
 * cascade from `Organization`, kept here as the same defense-in-depth the
 * original check already had, unchanged.
 *
 * Deliberately excludes `Invoice`/`Project`/`Task`/`Quote`/`Contract`/
 * `RecurringInvoice` and similar per-file leaf fixtures — every integration
 * file that creates those already owns its own `afterAll`/`afterEach`
 * `deleteMany` cleanup (confirmed across multiple files); this check exists
 * for the shared identity primitives most prone to silent cross-file
 * accumulation, exactly the class of bug the Role Fixture Cleanup defect
 * actually was. Do not broaden this list without the same proof this set
 * already has — it is not a generic "every table must be zero" sweep.
 */
const COUNTED_TABLES = [
  "User",
  "Organization",
  "Client",
  "Membership",
  "PortalUser",
  "Invitation",
  "ClientInvitation",
  "Attachment",
  "Activity",
  "PortalDownloadRequest",
] as const;

type TableResidue = { table: string; count: number };

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Mirrors isolated-postgres.ts's own `combineErrors`: never a throwing
 * `finally` (which would silently replace an earlier, genuinely more
 * important failure). Folds a newly-observed error into whatever is
 * already tracked, flattening into a single, never-nested `AggregateError`
 * whose own top-level `.message` still leads with the primary error's
 * message.
 */
function combineErrors(primaryError: unknown, newError: unknown): unknown {
  if (primaryError === undefined) {
    return newError;
  }
  const parts = primaryError instanceof AggregateError ? [...primaryError.errors] : [toError(primaryError)];
  parts.push(...(newError instanceof AggregateError ? newError.errors : [toError(newError)]));
  const leadMessage = parts[0] instanceof Error ? (parts[0] as Error).message : String(parts[0]);
  return new AggregateError(parts, `${leadMessage} (plus ${parts.length - 1} additional captured error(s))`);
}

/**
 * Thrown when, and only when, the final boundary observed residue — never
 * for a connect/query/client-shutdown failure, which surfaces as whatever
 * that underlying error actually was (see `assertIntegrationDbClean`).
 * Bounded by construction: `residue` lists only the tables that were
 * actually nonzero, never the full counted set, and `sampleLabels` (when
 * present) is capped at 5 entries total.
 */
export class IntegrationDbNotCleanError extends Error {
  readonly residue: readonly TableResidue[];

  constructor(residue: readonly TableResidue[], sampleLabels: readonly string[]) {
    const summary = residue.map((r) => `${r.table}=${r.count}`).join(", ");
    const sampleSuffix = sampleLabels.length > 0 ? ` (sample: ${sampleLabels.join(", ")})` : "";
    super(`Integration DB not clean: ${summary}${sampleSuffix}`);
    this.name = "IntegrationDbNotCleanError";
    this.residue = residue;
  }
}

async function sampleRootIdentityRows(client: pg.Client, table: "Organization" | "User"): Promise<string[]> {
  // Bounded, test-safe debugging aid only — at most 5 rows, id + name,
  // never a full table dump. Only ever queried for the two root-identity
  // models (Organization/User), and only when that table's own count was
  // already proven nonzero by the caller.
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM "${table}" ORDER BY "createdAt" DESC LIMIT 5`,
  );
  return rows.map((row) => `${table}:${row.id} (${row.name})`);
}

/**
 * The final-verifier check itself. Connects its own short-lived raw
 * client, counts exactly the ten tables above, and either returns quietly
 * (every count zero) or throws `IntegrationDbNotCleanError` naming every
 * nonzero table and its count, with a small bounded sample for
 * Organization/User if either of those is among the offenders. Always
 * ends its own client before returning or throwing; a failure while ending
 * the client is folded in via `combineErrors`, never allowed to mask a
 * real connect/query/residue failure that already happened (see that
 * function's own doc comment for why a throwing `finally` would be wrong
 * here).
 */
export async function assertIntegrationDbClean(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  let primaryError: unknown;

  try {
    await client.connect();
    const counts = await Promise.all(
      COUNTED_TABLES.map(async (table) => {
        const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
        return { table, count: rows[0].n };
      }),
    );
    const residue = counts.filter((row) => row.count > 0);
    if (residue.length > 0) {
      const sampleLabels: string[] = [];
      for (const { table } of residue) {
        if (table === "Organization" || table === "User") {
          sampleLabels.push(...(await sampleRootIdentityRows(client, table)));
        }
      }
      primaryError = new IntegrationDbNotCleanError(residue, sampleLabels);
    }
  } catch (err) {
    primaryError = err;
  }

  try {
    await client.end();
  } catch (endError) {
    primaryError = combineErrors(primaryError, endError);
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }
}
