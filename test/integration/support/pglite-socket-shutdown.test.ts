import { afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { connect as rawConnect } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer, PGLiteSocketHandler } from "@electric-sql/pglite-socket";
import {
  installHardenedPgliteSocketShutdown,
  assertNoPgliteSocketShutdownErrors,
  getPendingDetachCountForTesting,
  getCapturedServerErrorCountForTesting,
} from "../../support/pglite-socket-shutdown";

/**
 * Shared pg-pool / grants-residue defect (Defect #1) — directly proves
 * test/support/pglite-socket-shutdown.ts's own contract: that a new
 * connection is not admitted/processed until every prior handler's own
 * `detach()` has genuinely settled, that a detach failure is surfaced
 * truthfully (never an unhandled rejection, never silently swallowed),
 * and that `stop()` itself waits for every detach it triggers.
 *
 * Uses the real, installed `PGLiteSocketServer`/`PGLiteSocketHandler`
 * classes throughout. The only synthetic element is a single, shared,
 * swappable timing barrier installed on `PGLiteSocketHandler.prototype.
 * detach` exactly once (`beforeAll`, below), strictly *before*
 * `installHardenedPgliteSocketShutdown()` is ever called — the real
 * hardening wraps the barrier, which itself wraps the real original
 * detach, and every test reconfigures only the barrier's own current
 * mode (never re-patches `proto.detach` itself, which would silently
 * discard the already-installed hardening the module's own idempotency
 * guard would then refuse to reinstall — this was deliberately avoided
 * here, not merely by chance). The real detach behavior is never
 * replaced or skipped, only delayed, by a precise amount each test fully
 * controls.
 *
 * Own dedicated port range (55740-55744), independent of every other
 * isolated/shared-harness test file.
 */

type DetachFn = (this: PGLiteSocketHandler, close?: boolean) => Promise<PGLiteSocketHandler>;

type BarrierMode = { kind: "passthrough" } | { kind: "held"; promise: Promise<void> };

let barrierMode: BarrierMode = { kind: "passthrough" };

function holdNextDetaches(): { release: () => void; releaseWithError: (err: Error) => void } {
  let resolveFn: (() => void) | undefined;
  let rejectFn: ((err: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  barrierMode = { kind: "held", promise };
  return {
    release: () => resolveFn?.(),
    releaseWithError: (err: Error) => rejectFn?.(err),
  };
}

beforeAll(() => {
  const proto = PGLiteSocketHandler.prototype as unknown as { detach: DetachFn };
  const realDetach = proto.detach;
  proto.detach = function barrierGatedDetach(this: PGLiteSocketHandler, close?: boolean) {
    const mode = barrierMode;
    if (mode.kind === "passthrough") {
      return realDetach.call(this, close);
    }
    return mode.promise.then(() => realDetach.call(this, close));
  };
  // Installed exactly once, wrapping the barrier above — this is the
  // real, production hardening under test, unmodified.
  installHardenedPgliteSocketShutdown();
});

afterEach(() => {
  barrierMode = { kind: "passthrough" };
});

async function waitForSocketReady(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`socket never became reachable on port ${port}: ${String(lastError)}`);
}

async function startServer(port: number): Promise<{ pglite: PGlite; server: PGLiteSocketServer }> {
  const pglite = new PGlite();
  const server = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port, maxConnections: 5 });
  await server.start();
  await waitForSocketReady(port);
  return { pglite, server };
}

async function waitForPendingDetachCount(atLeast: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (getPendingDetachCountForTesting() < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("PGliteSocket detach / admission gate (Defect #1, main-process layer)", () => {
  it("A. admission waits for a pending detach: a new connection is not processed until the prior handler's real detach completes", async () => {
    const port = 55740;
    const { pglite, server } = await startServer(port);
    try {
      const barrier = holdNextDetaches();

      const clientA = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await clientA.connect();
      await clientA.end();

      await waitForPendingDetachCount(1);
      expect(getPendingDetachCountForTesting()).toBeGreaterThan(0);

      let bConnected = false;
      const clientB = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      const connectPromise = clientB.connect().then(() => {
        bConnected = true;
      });

      await Promise.race([connectPromise, new Promise((resolve) => setTimeout(resolve, 300))]);
      expect(bConnected).toBe(false);

      barrier.release();
      await connectPromise;
      expect(bConnected).toBe(true);

      const probe = await clientB.query("SELECT 1 AS n");
      expect(probe.rows[0].n).toBe(1);
      await clientB.end();
    } finally {
      await server.stop();
      await pglite.close();
    }
  }, 30_000);

  it("B. multiple pending detaches: a new connection waits for all of them", async () => {
    const port = 55741;
    const { pglite, server } = await startServer(port);
    try {
      let resolveA: (() => void) | undefined;
      let resolveA2: (() => void) | undefined;
      const promiseA = new Promise<void>((resolve) => {
        resolveA = resolve;
      });
      const promiseA2 = new Promise<void>((resolve) => {
        resolveA2 = resolve;
      });

      // Connect BOTH clients first, while the barrier is still
      // passthrough — admission itself is gated too (that's exactly what
      // this suite proves), so a pending detach must never be live yet
      // when either of these connects, or the second connect would
      // itself deadlock waiting on the first.
      const clientA = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await clientA.connect();
      const clientA2 = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await clientA2.connect();

      // Now disconnect both, each one's own detach held on its own,
      // independent promise.
      barrierMode = { kind: "held", promise: promiseA };
      await clientA.end();
      await waitForPendingDetachCount(1);

      barrierMode = { kind: "held", promise: promiseA2 };
      await clientA2.end();
      await waitForPendingDetachCount(2);
      expect(getPendingDetachCountForTesting()).toBe(2);

      let bConnected = false;
      const clientB = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      const connectPromise = clientB.connect().then(() => {
        bConnected = true;
      });

      resolveA?.();
      await Promise.race([connectPromise, new Promise((resolve) => setTimeout(resolve, 300))]);
      expect(bConnected).toBe(false);

      resolveA2?.();
      await connectPromise;
      expect(bConnected).toBe(true);
      await clientB.end();
    } finally {
      await server.stop();
      await pglite.close();
    }
  }, 30_000);

  it("C. a detach rejection is surfaced truthfully: no unhandled rejection, the incoming connection is refused, and assertNoPgliteSocketShutdownErrors throws", async () => {
    const port = 55742;
    const { pglite, server } = await startServer(port);
    const uncaughtHits: unknown[] = [];
    const onUncaught = (err: unknown) => uncaughtHits.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const barrier = holdNextDetaches();

      const clientA = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await clientA.connect();
      await clientA.end();
      await waitForPendingDetachCount(1);

      const detachFailure = new Error("SYNTHETIC_PROBE_DETACH_FAILURE");
      barrier.releaseWithError(detachFailure);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getCapturedServerErrorCountForTesting()).toBeGreaterThan(0);
      expect(uncaughtHits).toEqual([]);

      // Verified at the raw socket level, not via pg.Client: the gate's
      // own rejection (test/support/pglite-socket-shutdown.ts's own
      // `rejectIncomingSocket`) writes a plain diagnostic message and
      // ends the socket — exactly the same style the upstream library's
      // own "Too many connections" rejection already uses, which is not
      // valid Postgres wire-protocol framing. A raw socket observes this
      // directly and unambiguously (data received, then closed) without
      // depending on how any particular Postgres client library chooses
      // to interpret a non-protocol-compliant handshake response.
      const received: Buffer[] = [];
      let serverClosedConnection = false;
      await new Promise<void>((resolve, reject) => {
        const socket = rawConnect({ host: "127.0.0.1", port }, () => {
          // Trigger handleConnection by sending a few bytes, same as any
          // real client would as the very first thing on the wire.
          socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
        });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("raw socket probe timed out waiting for server close"));
        }, 5_000);
        socket.on("data", (chunk) => {
          received.push(chunk);
        });
        socket.on("close", () => {
          serverClosedConnection = true;
          clearTimeout(timer);
          resolve();
        });
        socket.on("error", () => {
          // A reset/error while probing still counts as "refused" —
          // resolution happens via the 'close' handler either way.
        });
      });
      const refused = serverClosedConnection && received.length > 0;
      expect(refused).toBe(true);

      expect(() => assertNoPgliteSocketShutdownErrors()).toThrow(/SYNTHETIC_PROBE_DETACH_FAILURE/);
      expect(() => assertNoPgliteSocketShutdownErrors()).not.toThrow();
    } finally {
      process.off("uncaughtException", onUncaught);
      await server.stop().catch(() => undefined);
      await pglite.close();
    }
  }, 30_000);

  it("D. server.stop() waits for a detach it triggers directly", async () => {
    const port = 55743;
    const { pglite, server } = await startServer(port);
    try {
      const barrier = holdNextDetaches();

      const clientA = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await clientA.connect();
      // Do NOT end clientA — leave it open so server.stop() itself is
      // what triggers this handler's own detach(true) call.

      let stopResolved = false;
      const stopPromise = server.stop().then(() => {
        stopResolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(stopResolved).toBe(false);

      barrier.release();
      await stopPromise;
      expect(stopResolved).toBe(true);
      expect(getPendingDetachCountForTesting()).toBe(0);

      await clientA.end().catch(() => undefined);
    } finally {
      await pglite.close();
    }
  }, 30_000);

  it("E. installHardenedPgliteSocketShutdown is idempotent: installing it multiple times patches the prototype exactly once", () => {
    const before = PGLiteSocketHandler.prototype.detach;
    installHardenedPgliteSocketShutdown();
    const after = PGLiteSocketHandler.prototype.detach;
    expect(after).toBe(before);
  });

  it("F. no semantic drift: with no pending detach, a normal connection is admitted and works exactly as before", async () => {
    const port = 55744;
    const { pglite, server } = await startServer(port);
    try {
      expect(getPendingDetachCountForTesting()).toBe(0);

      const client = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres" });
      await client.connect();
      const result = await client.query("SELECT 1 AS n");
      expect(result.rows[0].n).toBe(1);
      await client.end();
    } finally {
      await server.stop();
      await pglite.close();
    }
  }, 30_000);
});
