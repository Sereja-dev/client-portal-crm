import { PGLiteSocketHandler, PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Socket } from "node:net";

/**
 * Shared pg-pool / grants-residue defect (Defect #1) — the second,
 * main-process half of the complete fix. See `test/support/
 * pg-pool-shutdown.ts`'s own header comment for the worker-side half
 * (hardening `pg.Pool.prototype.end` so the TCP socket genuinely closes
 * before a file's own teardown resolves) — that half alone was proven
 * insufficient: targeted handoff stress passed, but full-suite stress
 * still reproduced `grants.test.ts` residue in 2/3 runs even with it
 * installed, because the remaining gap lives one layer deeper, entirely
 * server-side, in a process the worker-side patch can never reach.
 *
 * Process ownership (proved directly, both from Vitest's own official
 * documentation and empirically): `test/integration/global-setup.ts`
 * (`globalSetup`) runs once in a genuinely separate process from every
 * test file, *before* any worker process is even created — this is
 * where the one shared `PGlite` engine and `PGLiteSocketServer` actually
 * live (`test/support/local-postgres.ts`'s own `startTestDatabase()`).
 * `test/integration/setup-env.ts` (`setupFiles`) runs inside each test
 * file's own separate forked worker process. A prototype patch installed
 * from `setup-env.ts` can therefore never affect the objects this module
 * hardens — this module must be installed from `global-setup.ts` itself,
 * before `startTestDatabase()` is ever called.
 *
 * Root cause (proved directly against installed `@electric-sql/
 * pglite-socket` 0.2.7 source, `node_modules/@electric-sql/pglite-socket/
 * dist/chunk-E57PWKK6.js`, confirmed byte-identical through the latest
 * published 0.2.11 — no upstream fix exists to upgrade to):
 * `PGLiteSocketHandler.prototype.handleClose()` does:
 *
 *   this.active = false;
 *   this.dispatchEvent(new CustomEvent("close"));  // server removes this handler from its own Set HERE, synchronously
 *   this.detach(false);                            // fire-and-forget — NOT awaited
 *
 * `detach()` itself is `async` and contains a genuine await
 * (`queryQueue.clearTransactionIfNeeded(this.id)`, which can issue a real
 * `db.exec("ROLLBACK")` against the shared engine, *outside* the query
 * queue's own `runExclusive` mutex that otherwise serializes every
 * ordinary query). `PGLiteSocketServer.prototype.stop()` has the
 * identical pattern: `for (let e of this.handlers) e.detach(true)`, never
 * awaited either. No event or promise is exposed anywhere in the
 * installed library for "this handler's detach has genuinely finished" —
 * the server's own admission check (`handleConnection`'s `this.handlers.
 * size >= this.maxConnections`) is based purely on the Set, which is
 * already correctly up to date (removal happens synchronously via the
 * `"close"` dispatch, before `detach()` is even called) — meaning a brand
 * new connection can be freely admitted and begin real protocol work
 * against the shared engine while the *previous* handler's own async
 * detach tail (including a possible stray `ROLLBACK`) is still settling,
 * entirely invisible to, and unreachable from, the client-side socket-
 * close boundary the worker-side hardening already gets right.
 *
 * Design: `detach()` itself — not `handleClose()` or `stop()` separately
 * — is the one patch point. `handleClose()`'s own fire-and-forget call
 * and `stop()`'s own `for` loop both call `detach()` directly, so
 * patching `detach()` transparently captures every real detach this
 * library ever triggers, through every upstream code path, without
 * reimplementing any of that upstream orchestration or risking a double
 * detach. `detach` is also the one of these methods the library's own
 * `.d.ts` marks genuinely public (not `private`) — the intended, stable
 * extension point.
 *
 * This module has zero Production/runtime effect by construction: it is
 * never imported by any Product source file, only by `global-setup.ts`
 * (a test-only Vitest config entry), and it never touches `src/lib/
 * prisma.ts`'s own `createProductionPrismaClient()` path or anything it
 * depends on.
 */

const PATCHED_ORIGINAL_DETACH = Symbol.for("aqenra.testOnly.hardenedPgliteSocketShutdown.originalDetach");

type DetachFn = (this: PGLiteSocketHandler, close?: boolean) => Promise<PGLiteSocketHandler>;
type HandleConnectionFn = (this: PGLiteSocketServer, socket: Socket) => Promise<void>;
type StopFn = (this: PGLiteSocketServer) => Promise<void>;

type PatchableHandlerPrototype = {
  detach: DetachFn;
  [PATCHED_ORIGINAL_DETACH]?: DetachFn;
};

type PatchableServerPrototype = {
  handleConnection: HandleConnectionFn;
  stop: StopFn;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// Module-global by design, not a WeakMap keyed by server instance: this
// harness guarantees exactly one `PGLiteSocketServer` for the whole
// integration run (`test/support/local-postgres.ts`'s own module-level
// `socketServer` singleton) — a WeakMap would add indirection for a
// cardinality already proven to be exactly one.
const pendingDetaches = new Set<Promise<void>>();

// Bounded by construction, not by an explicit cap: in practice this can
// only ever grow by one entry per genuine detach failure, and a genuine
// detach failure is itself rare-to-never in correct operation — this is
// not a hot path that could accumulate unboundedly in a healthy run.
const capturedServerErrors: Error[] = [];

/**
 * Registers `resultPromise` (the real, original, unmodified return value
 * of a real `detach()` call) as pending, and removes it once settled.
 * Critically, the *tracked* promise added to the registry never itself
 * rejects — a detach failure is caught and recorded into
 * `capturedServerErrors` right here, synchronously attached in the same
 * tick this function runs, so Node can never consider the real
 * `resultPromise` (nor this tracked derivative of it) an unhandled
 * rejection, regardless of what upstream's own fire-and-forget call site
 * does with the value `detach()` itself returns. `Promise.all(...)` over
 * the registry (see `awaitPendingDetaches`) is therefore purely a wait —
 * it can never itself throw merely because a detach failed; failures are
 * surfaced explicitly, truthfully, via `capturedServerErrors` instead.
 */
function trackDetach(resultPromise: Promise<unknown>): void {
  const tracked: Promise<void> = resultPromise.then(
    () => undefined,
    (err) => {
      capturedServerErrors.push(toError(err));
    },
  );
  pendingDetaches.add(tracked);
  void tracked.finally(() => {
    pendingDetaches.delete(tracked);
  });
}

/**
 * Deterministic registry draining, not a retry loop: repeatedly snapshots
 * and awaits the current contents of `pendingDetaches` until the set is
 * genuinely empty. A plain single snapshot-then-await would be
 * insufficient if a new detach gets registered while the current batch
 * is still settling (e.g. `stop()`'s own loop triggering several at
 * once) — looping until truly empty closes that gap without any sleep or
 * polling timer, since each iteration's own `await` is purely event-
 * driven (resolves exactly when every currently-tracked promise in that
 * snapshot has settled).
 */
async function awaitPendingDetaches(): Promise<void> {
  while (pendingDetaches.size > 0) {
    const snapshot = [...pendingDetaches];
    await Promise.all(snapshot);
  }
}

function rejectIncomingSocket(socket: Socket): void {
  try {
    socket.write(Buffer.from("Isolated PGlite harness: a prior handler's detach failed; refusing this connection\n"));
  } catch {
    // Best-effort only — proceed to destroy regardless.
  }
  // `.destroy()`, not `.end()`: this connection was never attached to a
  // PGLiteSocketHandler (the gate runs before that happens), so nothing
  // upstream is tracking it — an immediate, forceful close avoids
  // leaving the underlying TCP connection in a state the server's own
  // `net.Server` keeps waiting on indefinitely during its own `close()`
  // (confirmed directly: a half-closed `.end()`-only rejection here
  // measurably delayed `PGLiteSocketServer.stop()`'s own resolution in
  // this module's regression coverage).
  try {
    socket.destroy();
  } catch {
    // Best-effort only — the real failure is already captured in
    // `capturedServerErrors` and will surface truthfully via
    // `assertNoPgliteSocketShutdownErrors()` regardless of whether this
    // specific socket could still be destroyed cleanly.
  }
}

/**
 * Installs the hardening, exactly once per process. Idempotent by
 * construction: a `Symbol.for`-keyed marker records the original
 * `detach` the very first time this runs, and every subsequent call is a
 * no-op that leaves the already-installed patches untouched.
 */
export function installHardenedPgliteSocketShutdown(): void {
  const handlerProto = PGLiteSocketHandler.prototype as unknown as PatchableHandlerPrototype;
  if (handlerProto[PATCHED_ORIGINAL_DETACH]) {
    return;
  }
  const originalDetach = handlerProto.detach;
  handlerProto[PATCHED_ORIGINAL_DETACH] = originalDetach;

  handlerProto.detach = function patchedDetach(this: PGLiteSocketHandler, close?: boolean) {
    const result = originalDetach.call(this, close);
    // Side-channel tracking only — the real, original promise is
    // returned unmodified below, preserving `detach()`'s exact upstream
    // contract for any caller (present or future) that does inspect its
    // return value, even though today's actual callers (`handleClose()`,
    // `stop()`) both ignore it.
    trackDetach(result);
    return result;
  };

  const serverProto = PGLiteSocketServer.prototype as unknown as PatchableServerPrototype;
  const originalHandleConnection = serverProto.handleConnection;
  const originalStop = serverProto.stop;

  serverProto.handleConnection = async function patchedHandleConnection(this: PGLiteSocketServer, socket: Socket) {
    // The gate runs before upstream's own `maxConnections` logic (inside
    // `originalHandleConnection`) by construction — this entire function
    // body runs first, and only calls into the original at the very end.
    // This makes the gate's own invariant independent of `maxConnections`
    // the way it must be: it is never based on, or interacting with, the
    // handler count.
    try {
      await awaitPendingDetaches();
    } catch (err) {
      // Defensive only — `awaitPendingDetaches` can only ever await
      // promises `trackDetach` already made non-rejecting, so this
      // branch should be unreachable in practice. Never let anything
      // escape this gate unhandled regardless.
      capturedServerErrors.push(toError(err));
      rejectIncomingSocket(socket);
      return;
    }
    if (capturedServerErrors.length > 0) {
      // A prior handler's own detach genuinely failed — the shared
      // engine's state cannot be trusted as clean. Refuse this
      // connection rather than let it run real protocol work against
      // potentially-corrupted state; the captured error(s) will fail the
      // whole integration run truthfully via
      // `assertNoPgliteSocketShutdownErrors()` at global teardown.
      rejectIncomingSocket(socket);
      return;
    }
    await originalHandleConnection.call(this, socket);
  } as HandleConnectionFn;

  serverProto.stop = async function patchedStop(this: PGLiteSocketServer) {
    // `stop()`'s own `for (let e of this.handlers) e.detach(true)` loop
    // calls `detach()` synchronously for every still-open handler before
    // this await below even begins — and because `detach()` itself is
    // what we patched (not `stop()`'s own loop), every one of those
    // calls is already registered into `pendingDetaches` (synchronously,
    // at call time — see `patchedDetach` above) by the time
    // `originalStop` resolves. No separate pre/post-stop snapshot
    // comparison is needed: `awaitPendingDetaches()` below drains
    // whatever is in the registry regardless of whether it was
    // registered by this `stop()` call or by an earlier, independent
    // `handleClose()`.
    await originalStop.call(this);
    await awaitPendingDetaches();
  } as StopFn;
}

/**
 * Called from `global-setup.ts`'s own `teardown()`, after the hardened
 * `stop()` above (and therefore after every handler's own detach has
 * genuinely settled). Throws truthfully if any detach ever failed during
 * this run — never a `console.warn`, never silently swallowed. Drains
 * (not just reads) the captured list, so this can safely be called more
 * than once without double-reporting the same failure.
 */
export function assertNoPgliteSocketShutdownErrors(): void {
  if (capturedServerErrors.length === 0) {
    return;
  }
  const errors = capturedServerErrors.splice(0, capturedServerErrors.length);
  if (errors.length === 1) {
    throw errors[0];
  }
  throw new AggregateError(errors, `${errors.length} PGliteSocket detach/admission-gate error(s) captured during this integration run`);
}

/**
 * Test-only inspection helpers for this module's own regression coverage
 * — never used by `global-setup.ts` itself.
 */
export function getPendingDetachCountForTesting(): number {
  return pendingDetaches.size;
}

export function getCapturedServerErrorCountForTesting(): number {
  return capturedServerErrors.length;
}
