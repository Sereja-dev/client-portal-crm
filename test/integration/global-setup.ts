import { startTestDatabase, stopTestDatabase, TEST_DATABASE_URL } from "../support/local-postgres";
import { assertIntegrationDbClean } from "../support/assert-integration-db-clean";

// Runs once in Vitest's main process before any integration test file
// loads, regardless of how many worker threads/processes run the actual
// tests — they all reach this same instance over its real TCP socket
// (see test/support/local-postgres.ts).
export async function setup(): Promise<void> {
  await startTestDatabase();
}

/**
 * Grants whole-suite final verifier (narrow test-architecture fix): this
 * is the proven, genuinely-guaranteed final boundary — teardown() runs
 * once in Vitest's main process, strictly after every worker test file's
 * own afterAll has completed (see test/support/assert-integration-db-
 * clean.ts's own doc comment for the full empirical proof), and strictly
 * before the shared PGlite engine is stopped below. Running the check
 * here, first, means it observes the real end-of-suite state regardless
 * of which file Vitest happened to schedule last.
 *
 * assertIntegrationDbClean(TEST_DATABASE_URL) connects its own short-
 * lived raw pg.Client directly — never the Product Prisma facade, which
 * this main process cannot safely construct (the worker-only
 * DATABASE_URL/PGLITE_TEST_DB env from test/integration/setup-env.ts does
 * not exist here).
 *
 * stopTestDatabase() must still run even if the verifier throws — a
 * failed assertion must never leave the shared engine/socket server
 * running past this test process's lifetime. Both stages are therefore
 * wrapped individually (never a throwing `finally`, which would let a
 * later failure silently replace an earlier, more important one), and if
 * both fail, their errors are combined into a single AggregateError so
 * neither is ever masked.
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function teardown(): Promise<void> {
  let primaryError: unknown;

  try {
    await assertIntegrationDbClean(TEST_DATABASE_URL);
  } catch (verifierError) {
    primaryError = verifierError;
  }

  try {
    await stopTestDatabase();
  } catch (stopError) {
    primaryError =
      primaryError === undefined
        ? stopError
        : new AggregateError(
            [toError(primaryError), toError(stopError)],
            `${toError(primaryError).message} (plus 1 additional captured error during teardown)`,
          );
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }
}
