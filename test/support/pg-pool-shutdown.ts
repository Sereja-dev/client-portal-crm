import pg from "pg";

/**
 * Shared pg-pool / grants-residue defect (Defect #1) — narrow test-only
 * hardening for the proven upstream `pg-pool` release-before-resolve
 * defect.
 *
 * Root cause (proved directly against installed `pg-pool` 3.14.0 source,
 * `node_modules/pg-pool/index.js`): `Pool.prototype.end()`'s own shutdown
 * sequence, when it has idle clients to tear down, calls `_pulseQueue()`'s
 * "ending" branch, which does:
 *
 *   this._idle.slice().map((item) => { this._remove(item.client) })
 *   if (!this._clients.length) { this.ended = true; this._endCallback() }
 *
 * `_remove(client)` itself does `this._clients = this._clients.filter(...)`
 * **synchronously** — removing the client from the pool's own bookkeeping
 * immediately — and only *then* calls `client.end(callback)`, whose
 * callback fires **asynchronously**, once the underlying connection's own
 * `'end'`/`'close'` sequence genuinely completes. Because `_clients` is
 * already empty by the time `_pulseQueue()` checks `!this._clients.length`
 * (still within the same synchronous call stack as `_remove`), `Pool.end()`'s
 * own promise (`this._endCallback()`) resolves **before** the real
 * underlying socket has finished closing — proved directly, deterministically,
 * against a real isolated PGlite instance (see this module's own regression
 * coverage, `test/integration/support/pg-pool-shutdown.test.ts`): the real
 * socket `'close'` event was observed firing after `Pool.end()`'s own promise
 * had already resolved, in every run.
 *
 * Consequence in this test harness specifically: every integration test
 * file runs in its own freshly-forked OS process with its own fresh
 * `pg.Pool` (see `test/integration/setup-env.ts`'s own header comment),
 * all connecting to the one shared, single-threaded PGlite engine
 * (`test/support/local-postgres.ts`). `setup-env.ts`'s own global
 * `afterAll` already calls `await prisma.$disconnect()` specifically to
 * close each file's connection before the next file opens its own — but
 * that call inherits this exact premature resolution (`$disconnect()` →
 * `@prisma/adapter-pg`'s own `dispose()` → `pool.end()`), so Vitest can
 * still advance to the next file while the previous file's own socket is
 * mid-close. The already-proven-flaky PGlite wire-protocol engine (see
 * the isolated-PGlite lifecycle repair's own root-cause tracing of a
 * *different*, query-level manifestation of the same class of upstream
 * defect) can then misattribute state across that overlap — the proven,
 * precise mechanism behind the intermittent `grants.test.ts` whole-suite
 * cleanup residue (`orgs: N`).
 *
 * This module does not, and must not, touch Production/runtime code:
 * `src/lib/prisma.ts`'s own `createProductionPrismaClient()` path never
 * imports this module, and Production never calls `$disconnect()`/
 * `pool.end()` during normal operation — this patch has no effect there,
 * by construction. It also does not touch the `PGLITE_TEST_DB` recovery
 * facade's own generation-rotation logic (`createPgliteRecoveryFacade()`
 * in `src/lib/prisma.ts`) — that stays exactly as shipped. What this
 * module hardens is the one shared, process-wide `pg.Pool.prototype.end`
 * method itself: every caller of `pool.end()`/`client.end()` in the
 * integration test process — `setup-env.ts`'s own explicit disconnect,
 * *and* the recovery facade's own fire-and-forget stale-generation
 * disconnect, which goes through the identical code path — now genuinely
 * waits for the real socket-close boundary before its own promise
 * resolves, with no change to when or why either of those callers
 * decides to disconnect.
 */

const PATCHED_ORIGINAL = Symbol.for("aqenra.testOnly.hardenedPoolEnd.original");

type PgPoolInternals = {
  _clients: unknown[];
};

type OriginalPoolEnd = (callback?: (err?: Error) => void) => Promise<void> | undefined;

type PatchablePoolPrototype = {
  end: OriginalPoolEnd;
  [PATCHED_ORIGINAL]?: OriginalPoolEnd;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Folds a newly-observed error into whatever error (if any) is already
 * tracked, without ever using a throwing `finally` to do it (which would
 * silently replace an earlier, equally real failure — see `runHardenedEnd`
 * below, which never relies on that). Mirrors the identical, already-
 * proven pattern in `test/support/isolated-postgres.ts`'s own
 * `combineErrors` — kept as a separate, independent copy here rather than
 * a shared import, since these two hardening modules address unrelated
 * defects in unrelated libraries and must stay independently correct and
 * independently reviewable.
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

function getUnderlyingSocket(client: unknown): NodeJS.EventEmitter & { destroyed?: boolean } {
  // `client.connection.stream` is the raw `net.Socket` — confirmed
  // directly against the installed `pg` 8.22.0 source
  // (`node_modules/pg/lib/connection.js`'s own `this.stream = ...`
  // assignment), the same field already relied on identically by the
  // isolated-PGlite lifecycle repair's own root-cause tracing
  // (`test/support/isolated-postgres.ts`). Pinned to this exact
  // installed `pg` version's internal shape, same as that module.
  const connection = (client as { connection?: { stream?: unknown } }).connection;
  return connection?.stream as NodeJS.EventEmitter & { destroyed?: boolean };
}

const SOCKET_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Waits for one client's underlying raw socket to reach the authoritative
 * "genuinely closed" boundary — the socket's own `'close'` event, proved
 * (see this module's own header comment) to fire strictly after
 * `pg-pool`'s own `Pool.prototype.end()` can already have resolved.
 * Event-driven, not a sleep: resolves the instant the real event fires,
 * or immediately if the socket is already destroyed. Listeners are
 * attached before any shutdown is ever triggered by this module's own
 * callers, so a synchronous or near-synchronous close can never be
 * missed. Bounded by a generous safety timeout so a genuine hang
 * surfaces as a truthful rejection rather than stalling teardown
 * forever — the mechanism itself stays fully event-driven; the timeout
 * is only a safety backstop against a close that never arrives at all.
 */
export function waitForSocketClose(client: unknown): Promise<void> {
  const stream = getUnderlyingSocket(client);
  if (!stream || stream.destroyed) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.removeListener("close", onClose);
      stream.removeListener("error", onError);
    };
    const onClose = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(toError(err));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitForSocketClose: underlying socket did not emit 'close' within ${SOCKET_CLOSE_TIMEOUT_MS}ms`));
    }, SOCKET_CLOSE_TIMEOUT_MS);
    stream.once("close", onClose);
    stream.once("error", onError);
  });
}

/**
 * The hardened orchestration itself, factored out from the
 * `Pool.prototype.end` patch so it can be exercised directly in
 * regression coverage against synthetic clients/a synthetic original-end
 * function, without requiring a real database connection for every error-
 * semantics case. Snapshots every client the pool currently owns *before*
 * invoking `originalEnd` (which synchronously clears the pool's own
 * internal client list as part of its own shutdown sequence — see this
 * module's own header comment), so the snapshot is guaranteed to include
 * every client this specific `end()` call is actually tearing down.
 *
 * Error semantics, matching every case required of this hardening:
 *   A. `originalEnd` succeeds, every socket closes cleanly → resolves.
 *   B. `originalEnd` itself rejects → that real error is preserved and
 *      (if no socket-close failure also occurs) thrown completely
 *      unmodified — never downgraded, never silently swallowed.
 *   C. `originalEnd` succeeds but a socket-close wait fails/times out →
 *      that failure is thrown, truthfully — never treated as "end()
 *      resolved, so we're done."
 *   D. both fail → neither is lost; combined via `combineErrors` (a flat,
 *      never-nested `AggregateError`, with the first-observed error's
 *      own message still leading the combined error's own message).
 */
export async function runHardenedEnd(pool: PgPoolInternals, originalEnd: OriginalPoolEnd): Promise<void> {
  const clientsToAwait = [...pool._clients];
  const closeWaiters = clientsToAwait.map((client) => waitForSocketClose(client));

  let primaryError: unknown;
  try {
    await originalEnd.call(pool);
  } catch (err) {
    primaryError = err;
  }

  const results = await Promise.allSettled(closeWaiters);
  for (const result of results) {
    if (result.status === "rejected") {
      primaryError = combineErrors(primaryError, result.reason);
    }
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }
}

/**
 * Installs the hardening patch on `pg.Pool.prototype.end`, exactly once
 * per process. Idempotent by construction: a `Symbol.for`-keyed marker
 * (process-wide, survives separate module-graph re-evaluations of this
 * same file within one process, matching the proven fresh-module-per-file
 * topology this suite actually uses — see this module's own header
 * comment) records the original function the very first time this runs,
 * and every subsequent call is a no-op that leaves the already-installed
 * patch untouched.
 */
export function installHardenedPoolShutdown(): void {
  const proto = pg.Pool.prototype as unknown as PatchablePoolPrototype;
  if (proto[PATCHED_ORIGINAL]) {
    return;
  }
  const originalEnd = proto.end;
  proto[PATCHED_ORIGINAL] = originalEnd;

  proto.end = function patchedEnd(this: PgPoolInternals, callback?: (err?: Error) => void) {
    if (callback) {
      runHardenedEnd(this, originalEnd).then(
        () => callback(),
        (err) => callback(toError(err)),
      );
      return undefined;
    }
    return runHardenedEnd(this, originalEnd);
  } as OriginalPoolEnd;
}

/**
 * Test-only escape hatch for this module's own regression coverage: the
 * real, original, unpatched `Pool.prototype.end`, captured at install
 * time — lets a test demonstrate the real upstream defect directly,
 * independent of whatever is currently installed on the shared
 * prototype (the hardening itself, once `installHardenedPoolShutdown`
 * has run anywhere in this process).
 */
export function getOriginalPoolEnd(): OriginalPoolEnd | undefined {
  const proto = pg.Pool.prototype as unknown as PatchablePoolPrototype;
  return proto[PATCHED_ORIGINAL];
}
