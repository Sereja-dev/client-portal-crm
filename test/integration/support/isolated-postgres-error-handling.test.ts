import { describe, expect, it } from "vitest";
import {
  createIsolatedRawClient,
  endIsolatedRawClient,
  startIsolatedDatabase,
  stopIsolatedDatabase,
  withIsolatedDatabase,
  reconnectIsolatedRawClient,
  RawClientProtocolError,
} from "../../support/isolated-postgres";

/**
 * Isolated PGlite lifecycle repair — PRE-PUSH CORRECTNESS HARDENING.
 * Directly proves the invariant test/support/isolated-postgres.ts's own
 * header comment states: any raw-client error this module's `'error'`
 * listener ever captures must deterministically fail the owning helper
 * invocation, never merely be logged.
 *
 * The genuine PGlite-side `parseComplete` race this module was built to
 * survive is, by its own documented nature, nondeterministic and cannot
 * be reliably triggered on demand (see docs/testing.md's own "never
 * 'fix' this with retries... or a schema change" — the same reasoning
 * means it cannot reliably be *provoked* on demand either). So this file
 * proves the failure-handling contract with a synthetic, directly-
 * emitted `'error'` event on a real, live, connected `IsolatedRawClient`
 * — exactly the mechanism `createIsolatedRawClient`'s own listener
 * reacts to, regardless of what produced it. Every database/socket/
 * client instance below is real (own dedicated ports, 55710-55716); this
 * file never mocks the helper it is testing.
 *
 * Response-misrouting workaround coverage (ports 55717-55725) — proves
 * `reconnectIsolatedRawClient`'s own contract directly: a fresh, working
 * client against the exact same still-live isolated database, prior
 * committed state visible across the reconnect (proving nothing was
 * restarted), independent error ownership between the old and new
 * client, truthful surfacing of an old client's already-captured error,
 * and the real end-to-end shape every affected test now uses (valid
 * insert, expected-reject insert, reconnect, valid insert), repeated to
 * demonstrate the workaround's own mechanics are consistently reliable.
 */

const REPO_ROOT = `${__dirname}/../../..`;

/** Attaches a temporary process-level uncaughtException guard for the duration of `fn`, and asserts none fired — proving a captured client error never escapes as a process-level crash, which is the original bug this whole module exists to prevent. This is a *test-side* observability aid only; the helper module itself never installs one (that remains explicitly forbidden — see its own header comment). */
async function assertNoUncaughtException<T>(fn: () => Promise<T>): Promise<T> {
  const hits: unknown[] = [];
  const onUncaught = (err: unknown) => hits.push(err);
  process.on("uncaughtException", onUncaught);
  try {
    return await fn();
  } finally {
    process.off("uncaughtException", onUncaught);
    expect(hits).toEqual([]);
  }
}

describe("test/support/isolated-postgres.ts — captured raw-client error handling (hardening)", () => {
  it("normal successful lifecycle remains clean: no synthetic error, withIsolatedDatabase resolves with the callback's own return value", async () => {
    await assertNoUncaughtException(async () => {
      const result = await withIsolatedDatabase(55710, REPO_ROOT, async (rawClient) => {
        const probe = await rawClient.query("SELECT 1 AS n");
        return probe.rows[0].n;
      });
      expect(result).toBe(1);
    });
  }, 30_000);

  it("A. callback succeeds, but a client error was captured: withIsolatedDatabase still rejects, deterministically, not merely warns", async () => {
    await assertNoUncaughtException(async () => {
      const synthetic = new Error("SYNTHETIC_PROBE_CLIENT_ERROR_A");
      await expect(
        withIsolatedDatabase(55711, REPO_ROOT, async (rawClient) => {
          await rawClient.query("SELECT 1");
          // Simulates exactly what pg's own _handleErrorEvent does when
          // the documented parseComplete race occurs: emit 'error' on
          // the client. createIsolatedRawClient's own listener (attached
          // before connect()) captures this into strayErrors instead of
          // letting it crash the process — proven by the surrounding
          // assertNoUncaughtException guard never seeing a hit.
          rawClient.emit("error", synthetic);
          return "callback finished normally";
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("SYNTHETIC_PROBE_CLIENT_ERROR_A") });
    });
  }, 30_000);

  it("A (low-level primitives). the same invariant holds for the two callers that use createIsolatedRawClient/endIsolatedRawClient directly, without the withIsolatedDatabase wrapper", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55712);
      try {
        const rawClient = await createIsolatedRawClient(database.databaseUrl);
        await rawClient.query("SELECT 1");
        rawClient.emit("error", new Error("SYNTHETIC_PROBE_CLIENT_ERROR_LOWLEVEL"));
        await expect(endIsolatedRawClient(rawClient)).rejects.toBeInstanceOf(RawClientProtocolError);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("the captured error remains genuinely visible/inspectable to the test, not just a boolean failure: RawClientProtocolError.cause is the original error object", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55713);
      try {
        const rawClient = await createIsolatedRawClient(database.databaseUrl);
        const original = new Error("SYNTHETIC_PROBE_ORIGINAL_CAUSE");
        rawClient.emit("error", original);
        let caught: unknown;
        try {
          await endIsolatedRawClient(rawClient);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(RawClientProtocolError);
        expect((caught as RawClientProtocolError).cause).toBe(original);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("B. callback throws, no client error: the original callback error is preserved and thrown completely unmodified (same object identity)", async () => {
    await assertNoUncaughtException(async () => {
      const callbackError = new Error("SYNTHETIC_PROBE_CALLBACK_ONLY_ERROR");
      await expect(
        withIsolatedDatabase(55714, REPO_ROOT, async (rawClient) => {
          await rawClient.query("SELECT 1");
          throw callbackError;
        }),
      ).rejects.toBe(callbackError);
    });
  }, 30_000);

  it("C. callback throws AND a client error is captured: neither error is lost — the callback error's own message leads, and both errors are inspectable", async () => {
    await assertNoUncaughtException(async () => {
      const callbackError = new Error("SYNTHETIC_PROBE_CALLBACK_ERROR_C");
      const clientError = new Error("SYNTHETIC_PROBE_CLIENT_ERROR_C");
      let caught: unknown;
      try {
        await withIsolatedDatabase(55715, REPO_ROOT, async (rawClient) => {
          await rawClient.query("SELECT 1");
          rawClient.emit("error", clientError);
          throw callbackError;
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      // The callback error's own message still leads the thrown value's
      // own top-level message (so a caller matching via
      // `.rejects.toThrow(/pattern/)` against the *real* test failure
      // keeps working even once a client error is folded in).
      expect((caught as Error).message).toContain("SYNTHETIC_PROBE_CALLBACK_ERROR_C");
      // Neither error is actually discarded: an AggregateError carries
      // both as distinct, inspectable entries.
      expect(caught).toBeInstanceOf(AggregateError);
      const errors = (caught as AggregateError).errors as unknown[];
      expect(errors).toContain(callbackError);
      expect(errors.some((e) => e instanceof RawClientProtocolError && (e as RawClientProtocolError).cause === clientError)).toBe(true);
    });
  }, 30_000);

  it("D. cleanup itself fails, with no primary callback/client error: the cleanup failure is surfaced truthfully, not swallowed", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55716);
      try {
        const rawClient = await createIsolatedRawClient(database.databaseUrl);
        await rawClient.query("SELECT 1");
        const endFailure = new Error("SYNTHETIC_PROBE_END_FAILURE");
        // Deterministically forces the client's own end() to fail,
        // rather than relying on nondeterministic internal pg/socket
        // timing to produce a real one — this exercises
        // endIsolatedRawClient's own `endError` handling path directly
        // and reproducibly. The isolated database itself is still torn
        // down for real via stopIsolatedDatabase below regardless of
        // this one client's own patched end().
        rawClient.end = (() => Promise.reject(endFailure)) as typeof rawClient.end;
        let caught: unknown;
        try {
          await endIsolatedRawClient(rawClient);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toContain("ending the raw isolated client itself failed");
        expect((caught as Error).cause).toBe(endFailure);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("reconnect produces a fresh working client against the same database, and database/schema state persists across the reconnect (a row committed before reconnecting is visible after)", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55717);
      try {
        await database.pglite.query(`CREATE TABLE reconnect_probe (id int PRIMARY KEY, val text)`);
        let rawClient = await createIsolatedRawClient(database.databaseUrl);
        await rawClient.query(`INSERT INTO reconnect_probe (id, val) VALUES (1, 'before-reconnect')`);

        rawClient = await reconnectIsolatedRawClient(rawClient, database.databaseUrl);

        // Same isolated engine, same already-committed row — nothing was
        // restarted or recreated.
        const row = await rawClient.query(`SELECT val FROM reconnect_probe WHERE id = 1`);
        expect(row.rows[0].val).toBe("before-reconnect");

        // The new client is itself genuinely live/working, not just
        // holding stale state.
        await rawClient.query(`INSERT INTO reconnect_probe (id, val) VALUES (2, 'after-reconnect')`);
        const count = await rawClient.query(`SELECT COUNT(*)::int AS n FROM reconnect_probe`);
        expect(count.rows[0].n).toBe(2);

        await endIsolatedRawClient(rawClient);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("a captured error on the old client still fails, truthfully, even though a reconnect follows it", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55718);
      try {
        const rawClient = await createIsolatedRawClient(database.databaseUrl);
        await rawClient.query("SELECT 1");
        rawClient.emit("error", new Error("SYNTHETIC_PROBE_PRE_RECONNECT_ERROR"));
        await expect(reconnectIsolatedRawClient(rawClient, database.databaseUrl)).rejects.toBeInstanceOf(RawClientProtocolError);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("the new client after reconnect has fully independent error ownership from the old one — an error captured on the new client is not confused with, or masked by, the old client's own (clean) teardown", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55719);
      try {
        let rawClient = await createIsolatedRawClient(database.databaseUrl);
        await rawClient.query("SELECT 1"); // old client: clean, no captured error.

        rawClient = await reconnectIsolatedRawClient(rawClient, database.databaseUrl);
        rawClient.emit("error", new Error("SYNTHETIC_PROBE_POST_RECONNECT_ERROR"));
        await expect(endIsolatedRawClient(rawClient)).rejects.toBeInstanceOf(RawClientProtocolError);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("reconnect does not restart the PGlite engine or socket server — the same IsolatedDatabase object (pglite, socketServer, databaseUrl) remains valid and is what the caller still tears down", async () => {
    await assertNoUncaughtException(async () => {
      const database = await startIsolatedDatabase(55720);
      const pgliteBefore = database.pglite;
      const socketServerBefore = database.socketServer;
      try {
        let rawClient = await createIsolatedRawClient(database.databaseUrl);
        rawClient = await reconnectIsolatedRawClient(rawClient, database.databaseUrl);
        expect(database.pglite).toBe(pgliteBefore);
        expect(database.socketServer).toBe(socketServerBefore);
        await endIsolatedRawClient(rawClient);
      } finally {
        await stopIsolatedDatabase(database);
      }
    });
  }, 30_000);

  it("reproduces the real affected-test shape end to end (valid insert, expected-reject insert, reconnect, valid insert) and proves it repeatably", async () => {
    await assertNoUncaughtException(async () => {
      for (let i = 0; i < 5; i++) {
        const database = await startIsolatedDatabase(55721 + i);
        try {
          await database.pglite.query(`CREATE TABLE reconnect_shape_probe (id int PRIMARY KEY)`);
          let rawClient = await createIsolatedRawClient(database.databaseUrl);

          await rawClient.query(`INSERT INTO reconnect_shape_probe (id) VALUES (1)`);
          await expect(rawClient.query(`INSERT INTO reconnect_shape_probe (id) VALUES (1)`)).rejects.toThrow(
            /duplicate key|unique constraint/i,
          );

          rawClient = await reconnectIsolatedRawClient(rawClient, database.databaseUrl);

          await expect(rawClient.query(`INSERT INTO reconnect_shape_probe (id) VALUES (2)`)).resolves.toBeDefined();
          const count = await rawClient.query(`SELECT COUNT(*)::int AS n FROM reconnect_shape_probe`);
          expect(count.rows[0].n).toBe(2);

          await endIsolatedRawClient(rawClient);
        } finally {
          await stopIsolatedDatabase(database);
        }
      }
    });
  }, 60_000);
});
