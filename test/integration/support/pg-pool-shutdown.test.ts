import { describe, expect, it } from "vitest";
import pg from "pg";
import { startIsolatedDatabase, stopIsolatedDatabase } from "../../support/isolated-postgres";
import {
  installHardenedPoolShutdown,
  getOriginalPoolEnd,
  waitForSocketClose,
  runHardenedEnd,
} from "../../support/pg-pool-shutdown";

/**
 * Shared pg-pool / grants-residue defect (Defect #1) — directly proves
 * both halves of test/support/pg-pool-shutdown.ts's own contract: that
 * the real, unpatched `pg.Pool.prototype.end()` can resolve before the
 * underlying socket has genuinely closed (the real upstream defect), and
 * that the hardening installed by test/integration/setup-env.ts actually
 * closes that gap.
 *
 * Reuses the isolated-PGlite lifecycle repair's own `startIsolatedDatabase`/
 * `stopIsolatedDatabase` primitives purely as a convenient way to stand up
 * a real, disposable Postgres-compatible engine + socket — plain reuse of
 * already-shipped, stable infrastructure, not a modification of Defect
 * #2's own code, and unrelated to that defect's own raw-`pg.Client`
 * lifecycle concerns (this file only ever uses `pg.Pool`).
 *
 * Own dedicated ports, 55730-55734, independent of every other isolated-
 * PGlite test file and of the shared canonical harness.
 */

function getUnderlyingSocket(client: pg.PoolClient): NodeJS.EventEmitter & { destroyed?: boolean } {
  return (client as unknown as { connection: { stream: NodeJS.EventEmitter & { destroyed?: boolean } } }).connection.stream;
}

describe("pg-pool Pool.end() release-before-resolve defect and hardening (Defect #1)", () => {
  it("PROVEN DEFECT: the raw, unpatched pg.Pool.prototype.end() can resolve before the underlying socket's own 'close' event fires", async () => {
    const database = await startIsolatedDatabase(55730);
    try {
      // Calls the ORIGINAL, unpatched end() directly — bypassing whatever
      // is currently installed on the shared Pool.prototype (the
      // hardening, process-wide-installed by setup-env.ts in the real
      // suite) — so this demonstrates the real, underlying library
      // defect directly and deterministically, never probabilistically.
      const originalEnd = getOriginalPoolEnd();
      expect(originalEnd).toBeDefined();

      const pool = new pg.Pool({ connectionString: database.databaseUrl, max: 1 });
      const client = await pool.connect();
      const stream = getUnderlyingSocket(client);
      client.release();

      let socketClosed = false;
      stream.once("close", () => {
        socketClosed = true;
      });

      await originalEnd!.call(pool as unknown as { _clients: unknown[] });

      // Deterministic, not timing-dependent: checked synchronously, in
      // the same tick the real end() promise already resolved in.
      expect(socketClosed).toBe(false);
    } finally {
      await stopIsolatedDatabase(database);
    }
  }, 30_000);

  it("HARDENED: the patched pg.Pool.prototype.end() does not resolve until the underlying socket has genuinely closed", async () => {
    const database = await startIsolatedDatabase(55731);
    try {
      installHardenedPoolShutdown(); // idempotent — safe even if setup-env.ts already installed it.

      const pool = new pg.Pool({ connectionString: database.databaseUrl, max: 1 });
      const client = await pool.connect();
      const stream = getUnderlyingSocket(client);
      client.release();

      let socketClosed = false;
      stream.once("close", () => {
        socketClosed = true;
      });

      await pool.end(); // the now-patched version — this is the real contract Prisma/$disconnect() exercises.

      // By the time the HARDENED end() resolves, the real socket close
      // must already have happened — deterministic, checked synchronously.
      expect(socketClosed).toBe(true);
      expect(stream.destroyed).toBe(true);
    } finally {
      await stopIsolatedDatabase(database);
    }
  }, 30_000);

  it("waitForSocketClose resolves immediately for an already-destroyed socket, without waiting for a future event", async () => {
    const database = await startIsolatedDatabase(55732);
    try {
      const pool = new pg.Pool({ connectionString: database.databaseUrl, max: 1 });
      const client = await pool.connect();
      const stream = getUnderlyingSocket(client);
      client.release();
      await pool.end();
      expect(stream.destroyed).toBe(true);

      // Calling it again, after the socket is already closed, must
      // resolve immediately rather than hang waiting for a 'close' that
      // will never fire again.
      await expect(waitForSocketClose(client)).resolves.toBeUndefined();
    } finally {
      await stopIsolatedDatabase(database);
    }
  }, 30_000);

  it("installHardenedPoolShutdown is idempotent: installing it multiple times patches Pool.prototype.end exactly once", () => {
    installHardenedPoolShutdown();
    const afterFirst = pg.Pool.prototype.end;
    installHardenedPoolShutdown();
    const afterSecond = pg.Pool.prototype.end;
    expect(afterSecond).toBe(afterFirst);
  });

  it("error semantics A: original end() succeeds, every socket closes cleanly — resolves with no error", async () => {
    const closingEmitter = new (await import("node:events")).EventEmitter() as unknown as NodeJS.EventEmitter & {
      destroyed?: boolean;
    };
    closingEmitter.destroyed = false;
    const fakeClient = { connection: { stream: closingEmitter } };
    const originalEnd = async () => {
      queueMicrotask(() => closingEmitter.emit("close"));
    };

    await expect(runHardenedEnd({ _clients: [fakeClient] }, originalEnd)).resolves.toBeUndefined();
  });

  it("error semantics B: original end() itself rejects, with no client to await — the real error is preserved completely unmodified (same object identity)", async () => {
    const endFailure = new Error("SYNTHETIC_PROBE_ORIGINAL_END_FAILURE");
    const originalEnd = async () => {
      throw endFailure;
    };

    await expect(runHardenedEnd({ _clients: [] }, originalEnd)).rejects.toBe(endFailure);
  });

  it("error semantics C: original end() succeeds but a socket-close wait fails — that failure is thrown truthfully, not treated as success", async () => {
    const erroringEmitter = new (await import("node:events")).EventEmitter() as unknown as NodeJS.EventEmitter & {
      destroyed?: boolean;
    };
    erroringEmitter.destroyed = false;
    const fakeClient = { connection: { stream: erroringEmitter } };
    const socketFailure = new Error("SYNTHETIC_PROBE_SOCKET_ERROR");
    const originalEnd = async () => {
      queueMicrotask(() => erroringEmitter.emit("error", socketFailure));
    };

    let caught: unknown;
    try {
      await runHardenedEnd({ _clients: [fakeClient] }, originalEnd);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("SYNTHETIC_PROBE_SOCKET_ERROR");
  });

  it("error semantics D: both original end() and a socket-close wait fail — neither error is lost", async () => {
    const erroringEmitter = new (await import("node:events")).EventEmitter() as unknown as NodeJS.EventEmitter & {
      destroyed?: boolean;
    };
    erroringEmitter.destroyed = false;
    const fakeClient = { connection: { stream: erroringEmitter } };
    const endFailure = new Error("SYNTHETIC_PROBE_END_FAILURE_D");
    const socketFailure = new Error("SYNTHETIC_PROBE_SOCKET_FAILURE_D");
    const originalEnd = async () => {
      queueMicrotask(() => erroringEmitter.emit("error", socketFailure));
      throw endFailure;
    };

    let caught: unknown;
    try {
      await runHardenedEnd({ _clients: [fakeClient] }, originalEnd);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("SYNTHETIC_PROBE_END_FAILURE_D");
    expect(caught).toBeInstanceOf(AggregateError);
    const errors = (caught as AggregateError).errors as unknown[];
    expect(errors).toContain(endFailure);
    expect(errors.some((e) => e instanceof Error && e.message.includes("SYNTHETIC_PROBE_SOCKET_FAILURE_D"))).toBe(true);
  });

  it("multi-generation coverage: the hardening applies uniformly to a second, independently-created pool/socket in the same process, not just the first one patched", async () => {
    const database = await startIsolatedDatabase(55733);
    const database2 = await startIsolatedDatabase(55734);
    try {
      installHardenedPoolShutdown();

      const poolA = new pg.Pool({ connectionString: database.databaseUrl, max: 1 });
      const clientA = await poolA.connect();
      const streamA = getUnderlyingSocket(clientA);
      clientA.release();

      const poolB = new pg.Pool({ connectionString: database2.databaseUrl, max: 1 });
      const clientB = await poolB.connect();
      const streamB = getUnderlyingSocket(clientB);
      clientB.release();

      let closedA = false;
      let closedB = false;
      streamA.once("close", () => {
        closedA = true;
      });
      streamB.once("close", () => {
        closedB = true;
      });

      await poolA.end();
      expect(closedA).toBe(true);

      await poolB.end();
      expect(closedB).toBe(true);
    } finally {
      await stopIsolatedDatabase(database);
      await stopIsolatedDatabase(database2);
    }
  }, 30_000);
});
