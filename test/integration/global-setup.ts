import { startTestDatabase, stopTestDatabase, TEST_DATABASE_URL } from "../support/local-postgres";
import { assertIntegrationDbClean } from "../support/assert-integration-db-clean";
import { installHardenedPgliteSocketShutdown, assertNoPgliteSocketShutdownErrors } from "../support/pglite-socket-shutdown";

// Runs once in Vitest's main process before any integration test file
// loads, regardless of how many worker threads/processes run the actual
// tests — they all reach this same instance over its real TCP socket
// (see test/support/local-postgres.ts).
//
// Shared pg-pool / grants-residue defect (Defect #1) — the main-process
// half of the PGliteSocket hardening (see test/support/pglite-socket-
// shutdown.ts's own header comment for the full mechanism and why this
// patch MUST be installed here, not from test/integration/setup-env.ts:
// that file runs inside each test file's own separate worker process,
// which can never reach the PGlite engine/PGLiteSocketServer objects —
// only startTestDatabase() below, running in this same main process,
// actually constructs them). Installed before startTestDatabase() so the
// hardening is in place before any PGLiteSocketServer/PGLiteSocketHandler
// instance — or the event that would first exercise it — can possibly
// exist.
export async function setup(): Promise<void> {
  installHardenedPgliteSocketShutdown();
  await startTestDatabase();
}

/**
 * Teardown runs three independent stages, in this exact order, each
 * attempted regardless of whether an earlier one failed, with every
 * failure preserved (never a throwing `finally`, which would let a later
 * stage's failure silently replace an earlier, more important one — see
 * `combineTeardownErrors` below, which mirrors test/support/assert-
 * integration-db-clean.ts's own identical `combineErrors` pattern):
 *
 * 1. Grants whole-suite final verifier (assertIntegrationDbClean): the
 *    proven, genuinely-guaranteed final boundary — teardown() runs once
 *    in Vitest's main process, strictly after every worker test file's
 *    own afterAll has completed (see that module's own doc comment for
 *    the full empirical proof), and strictly before the shared PGlite
 *    engine is stopped below. Running this first means it observes the
 *    real end-of-suite state regardless of which file Vitest happened to
 *    schedule last, while the engine/socket server are still fully alive
 *    and queryable via a raw pg.Client built from TEST_DATABASE_URL —
 *    never the Product Prisma facade, which this main process cannot
 *    safely construct (the worker-only DATABASE_URL/PGLITE_TEST_DB env
 *    from test/integration/setup-env.ts does not exist here).
 * 2. stopTestDatabase(): always runs, even if the verifier above threw —
 *    a failed assertion must never leave the shared engine/socket server
 *    running past this test process's lifetime. Its own call to
 *    PGLiteSocketServer.stop() is transparently the hardened version
 *    installed in setup() above (the patch lives on the prototype, so no
 *    call-site change is needed inside test/support/local-postgres.ts):
 *    hardened stop() does not resolve until every handler's own detach
 *    has genuinely settled.
 * 3. assertNoPgliteSocketShutdownErrors(): runs after stopTestDatabase()
 *    has resolved or thrown, checking every detach/server error captured
 *    across the entire run (not just this final stop) — see test/
 *    support/pglite-socket-shutdown.ts's own header comment for why this
 *    must be the last stage: the pending-detach registry it drains can
 *    only be considered complete once hardened stop()'s own drain has
 *    already finished.
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Folds a newly-observed stage error into whatever is already tracked,
 * flattening into a single, never-nested AggregateError whose own
 * top-level `.message` still leads with the primary error's message —
 * mirrors test/support/assert-integration-db-clean.ts's own identical
 * `combineErrors`, the established repo pattern for this exact problem.
 */
function combineTeardownErrors(primaryError: unknown, newError: unknown): unknown {
  if (primaryError === undefined) {
    return newError;
  }
  const parts = primaryError instanceof AggregateError ? [...primaryError.errors] : [toError(primaryError)];
  parts.push(...(newError instanceof AggregateError ? newError.errors : [toError(newError)]));
  const leadMessage = parts[0] instanceof Error ? (parts[0] as Error).message : String(parts[0]);
  return new AggregateError(parts, `${leadMessage} (plus ${parts.length - 1} additional captured error(s) during teardown)`);
}

/**
 * Runs every stage in order, regardless of whether an earlier one threw,
 * and throws at the end with every failure preserved (one error
 * unwrapped if only one stage failed, a flat AggregateError if more than
 * one did). Exported so the error-composition behavior — independent of
 * any real database/socket work — is directly testable with synthetic
 * stage functions (see test/integration/support/global-teardown-error-
 * composition.test.ts), without needing to boot a database to exercise
 * all 2^3 pass/fail combinations across three stages.
 */
export async function runTeardownStages(stages: readonly (() => Promise<void>)[]): Promise<void> {
  let primaryError: unknown;
  for (const stage of stages) {
    try {
      await stage();
    } catch (err) {
      primaryError = combineTeardownErrors(primaryError, err);
    }
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
}

export async function teardown(): Promise<void> {
  await runTeardownStages([
    () => assertIntegrationDbClean(TEST_DATABASE_URL),
    () => stopTestDatabase(),
    () => Promise.resolve(assertNoPgliteSocketShutdownErrors()),
  ]);
}
