import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * Isolated PGlite lifecycle repair (narrow test-harness fix) — one
 * hardened, shared home for the "own disposable PGlite + own
 * PGLiteSocketServer + a single raw, non-pooled pg.Client on its own
 * port" technique six schema/migration-contract integration tests each
 * used to duplicate locally (see docs/testing.md's own "Related but
 * distinct: raw isolated pg.Client variant" section). These tests
 * deliberately bypass the shared canonical harness (test/support/
 * local-postgres.ts) and Prisma entirely — a schema/constraint-level
 * assertion needs to inspect pg_constraint/pg_indexes/information_schema
 * directly, and some need to apply a partial migration history — so this
 * module is a real isolated Postgres engine + real socket + real raw
 * client, never a mock, never a Prisma-facade substitution.
 *
 * Root cause this fixes (proved directly against the installed `pg`
 * 8.22.0 source, `node_modules/pg/lib/client.js`): `Client.
 * _handleParseComplete()` calls `this._getActiveQuery()`, and if that is
 * `null` — a `parseComplete` message arriving when the client doesn't
 * consider any query active, the documented "race corrupting which
 * response the client reads" — it builds an
 * `Error('Received unexpected parseComplete message from backend.')` and
 * routes it through `_handleErrorEvent`, which unconditionally calls
 * `this.emit('error', err)`. A plain Node `EventEmitter` throws an
 * emitted `'error'` with zero listeners as an **uncaught exception** —
 * none of the six original per-file client instances ever attached an
 * `'error'` listener, which is the exact, provable, mechanical reason
 * this specific race previously escaped as an async, unhandled exception
 * detached from whatever `await` chain the test itself was in (and
 * therefore sometimes misattributed by the test runner to a
 * temporally-adjacent, unrelated test — exactly as documented).
 *
 * This module does not, and cannot, eliminate the underlying wire-
 * protocol nondeterminism itself (a genuine PGlite-side timing race,
 * confirmed pre-existing and out of scope for a lifecycle fix — see
 * docs/testing.md's own explicit "never 'fix' this with retries, longer
 * arbitrary timeouts, weakened assertions, or a schema change"). What it
 * does fix, deterministically: (1) every raw client this module creates
 * has a real `'error'` listener attached before it is ever used, so the
 * exact class of stray, no-active-query protocol error above is captured
 * as observable data instead of crashing the process; (2) teardown order
 * is centralized and explicit (client fully ended, THEN socket server
 * stopped, THEN the PGlite engine closed — never the reverse, never
 * concurrent) so a test can never race its own teardown against a query
 * that might still be settling.
 *
 * PRE-PUSH CORRECTNESS HARDENING (prior revision): capturing a stray
 * client error into `strayErrors` is only half the job — the original
 * revision of this module stopped there and merely `console.warn`ed,
 * which let a genuinely-raced test finish "successfully" with a real,
 * observed client/protocol error quietly downgraded to a log line. That
 * is never acceptable for a test harness. The invariant that revision
 * introduced, and this one keeps unconditionally: **any stray error a raw
 * client this module created ever captures deterministically fails the
 * owning helper invocation** — see `endIsolatedRawClient` below, the
 * single authoritative choke point both usage patterns (the
 * `withIsolatedDatabase` convenience wrapper, and the files that call the
 * low-level primitives directly) always pass through before a test can be
 * considered "done" with its client. This is sound as a *complete*
 * boundary, not just a best-effort one: `pg.Client.end()`'s own promise
 * resolves exactly on the underlying connection's `'end'` event, which —
 * per `node_modules/pg/lib/connection.js` — only fires once the
 * *readable* side of the socket has itself ended (the other side's own
 * FIN received), meaning no further protocol message, and therefore no
 * further `'error'` emission from this exact mechanism, can arrive after
 * that point. Checking `strayErrors` immediately after `await
 * rawClient.end()` settles is therefore not a best-effort snapshot — it
 * is guaranteed to see every stray error this client's entire connected
 * lifetime could ever produce.
 *
 * RESPONSE-MISROUTING WORKAROUND (this revision): the truthful-failure
 * hardening above is what made a *second*, deeper, genuinely upstream
 * defect observable at all — proved directly, via a disposable
 * out-of-repo wire-protocol trace against a real isolated PGlite +
 * `pg.Client` pair, to live inside `@electric-sql/pglite` 0.5.4's own
 * extended-query-protocol response emission: after a `Bind`/`Execute`
 * step fails (an ordinary, expected SQL error — a constraint violation,
 * not a wire-level defect), PGlite deterministically emits one extra,
 * protocol-noncompliant `ReadyForQuery`, and — less often, but directly
 * reproduced — a fuller phantom response cycle (`parseComplete` +
 * `commandComplete`) that can be misattributed to whichever query is
 * `_activeQuery` at the moment it finally arrives. Confirmed NOT caused
 * by `pg`, `pg-protocol`, or `@electric-sql/pglite-socket` (its own
 * socket handler is a thin byte relay straight into PGlite's own
 * `execProtocolRawStream` — see its `dist/chunk-*.js`). Confirmed to
 * require nothing more than: one raw client, one extended-protocol query
 * that fails with an expected SQL error, followed by *any* further query
 * on that *same* client — isolated single-test reproduction showed a real
 * test with that exact shape failing repeatably (across multiple files),
 * while the identical file's own tests where a rejection is the *last*
 * query on its client never failed.
 *
 * `reconnectIsolatedRawClient` below is the narrow, test-only workaround:
 * once a client has just been used for an expected-rejection query, and
 * the test needs to run *another* query, ending that connection and
 * opening a fresh one against the same still-live isolated database
 * eliminates PGlite's own opportunity to misattribute a phantom trailing
 * message — there is no longer a "next query on the same connection" for
 * it to land on. This does not weaken the truthful-failure invariant
 * above in any way: `reconnectIsolatedRawClient` ends the old client
 * through the exact same hardened `endIsolatedRawClient`, so if that old
 * client had *already* captured a real stray error before the reconnect
 * point, that failure still surfaces, truthfully, exactly as before. The
 * workaround only ever prevents a *future* query from inheriting a
 * *different* query's stray response — it never suppresses an error that
 * already happened.
 */

const execFileAsync = promisify(execFile);

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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`isolated PGlite socket server never became reachable on port ${port}: ${String(lastError)}`);
}

export type IsolatedDatabase = {
  databaseUrl: string;
  pglite: PGlite;
  socketServer: PGLiteSocketServer;
};

/**
 * Steps 1-2 of the required lifecycle: create the PGlite engine, start
 * its socket server on `port`, wait for a real TCP handshake to succeed
 * (mirrors the shared canonical harness's own identical
 * waitForSocketReady precedent in test/support/local-postgres.ts — the
 * socket server's own `start()` can resolve slightly before the
 * underlying net.Server actually accepts connections), then create the
 * two inert Supabase-role stand-ins every migration history expects to
 * find. Returns the raw `databaseUrl` for the caller to run `prisma
 * migrate deploy` (or a partial-history variant) against — this module
 * has no opinion on migration strategy; that stays test-owned, since two
 * of the six callers need a non-trivial partial-history dance this
 * shared helper must not know about.
 */
export async function startIsolatedDatabase(port: number): Promise<IsolatedDatabase> {
  const pglite = new PGlite();
  const socketServer = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port, maxConnections: 5 });
  await socketServer.start();
  await waitForSocketReady(port);
  await pglite.query("CREATE ROLE anon NOLOGIN");
  await pglite.query("CREATE ROLE authenticated NOLOGIN");
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  return { databaseUrl, pglite, socketServer };
}

/**
 * Steps 9-10 of the required lifecycle, always in this exact order and
 * always fully awaited: stop the socket server (no more connections
 * accepted, existing ones closed at the socket-server level) THEN close
 * the PGlite engine. Never the two concurrently, never reversed — this
 * is the one centralization point that previously had six independently-
 * maintained (and therefore driftable) copies. Callers must have already
 * ended every raw client they created against this database before
 * calling this (steps 6-8 are the caller's own responsibility, via
 * `endIsolatedRawClient` below, precisely because the six files' own
 * business logic — what queries run, in what order, with what
 * mid-flight directory-move choreography for two of them — determines
 * exactly when "all caller DB work has settled" truly means).
 */
export async function stopIsolatedDatabase({ pglite, socketServer }: IsolatedDatabase): Promise<void> {
  await socketServer.stop();
  await pglite.close();
}

/**
 * Applies the COMPLETE migration history (every migration, from zero) —
 * the actual deployment sequence, not a partial/pre-this-migration
 * state. Shared verbatim behavior across the four callers that just need
 * "deploy everything, then hand me a connection" (the two callers that
 * need a partial/move-aside history keep that choreography in their own
 * file — it is business logic specific to proving one migration's own
 * guard/ordering contract, not a lifecycle concern).
 */
export async function deployFullMigrationHistory(databaseUrl: string, repoRoot: string): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  });
}

/**
 * Step 3-4 of the required lifecycle: create a raw, non-pooled
 * `pg.Client` and connect it — with the one real hardening this whole
 * module exists for: a real `'error'` listener attached BEFORE
 * `connect()` ever runs, so the documented no-active-query
 * `parseComplete` race (see this module's own header comment) is
 * observed as data, never an uncaught process-level exception. Every
 * captured stray error is pushed onto the client's own `strayErrors`
 * array — inert storage only; `createIsolatedRawClient` itself never
 * inspects or acts on it. `endIsolatedRawClient` below is the sole place
 * this array is ever read and enforced, so there is exactly one place in
 * this module that decides "does a captured error fail this test."
 */
export type IsolatedRawClient = pg.Client & { strayErrors: unknown[] };

export async function createIsolatedRawClient(databaseUrl: string): Promise<IsolatedRawClient> {
  const rawClient = new pg.Client({ connectionString: databaseUrl }) as IsolatedRawClient;
  rawClient.strayErrors = [];
  rawClient.on("error", (err) => {
    rawClient.strayErrors.push(err);
  });
  await rawClient.connect();
  return rawClient;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The response-misrouting workaround (see this module's own header
 * comment for the proven upstream `@electric-sql/pglite` root cause):
 * ends `oldClient` and opens a brand-new, independently-hardened raw
 * client against the exact same `databaseUrl` — same isolated PGlite
 * engine, same socket endpoint, same already-committed schema/data, only
 * a new TCP connection and a new server-side backend process. Restarts
 * nothing: it does not touch the PGlite engine, the socket server, or any
 * schema/data — those all persist untouched, exactly as a caller
 * continuing to use `oldClient` would have seen them.
 *
 * Built from the two existing hardened primitives, deliberately adding no
 * new error-handling logic of its own: `endIsolatedRawClient(oldClient)`
 * is the same single authoritative enforcement point every other caller
 * already goes through, so if `oldClient` had *already* captured a real
 * stray error (or its own `end()` itself fails) *before* this reconnect
 * point, that failure still surfaces here, truthfully, exactly as it
 * would without a reconnect — this function only ever prevents a *future*
 * query from inheriting a stray response; it never retroactively excuses
 * one that already happened. `createIsolatedRawClient(databaseUrl)` then
 * returns a fresh client with its own independent `'error'` listener and
 * its own independent `strayErrors`, fully decoupled from whatever the
 * old connection did or did not observe.
 *
 * Callers must use the *returned* client for every subsequent query —
 * `oldClient` is fully ended by the time this resolves and must not be
 * queried again. Whichever client is still open when the caller is done —
 * the original one, if it never reconnected, or the latest reconnected one
 * otherwise — is the caller's own responsibility to end, via
 * `endIsolatedRawClient`, exactly once, before returning. This matters
 * most for the `withIsolatedDatabase` convenience wrapper below: its own
 * callback receives the *original* client as an argument, and the
 * wrapper's own automatic teardown only ever knows about that original
 * reference — if the callback reconnects, that automatic teardown call
 * becomes a harmless no-op on the now-stale original (safe by
 * construction: `pg.Client.end()` is idempotent, and this function has
 * already drained `oldClient.strayErrors` to empty), but it does **not**
 * end whatever client the callback reconnected *to*. A callback that
 * reconnects must therefore explicitly call `endIsolatedRawClient` on its
 * own latest client itself, as the last thing it does, or that final
 * client's own captured errors would never be enforced and its connection
 * would leak. The two low-level-primitive callers do not have this
 * concern — they already call `endIsolatedRawClient` explicitly at the
 * end of their own `it()` body; reconnecting there just means that final
 * call needs to reference whichever client variable is current.
 */
export async function reconnectIsolatedRawClient(oldClient: IsolatedRawClient, databaseUrl: string): Promise<IsolatedRawClient> {
  await endIsolatedRawClient(oldClient);
  return createIsolatedRawClient(databaseUrl);
}

/**
 * Thrown by `endIsolatedRawClient` when exactly one contributing error
 * (a single captured stray protocol error, or the `end()` call itself
 * failing, but not both) is why the client's lifetime is being reported
 * as a failure. Kept as a distinct, dedicated type — rather than
 * re-throwing the raw captured error unchanged — specifically so a
 * caller (or an assertion in this module's own regression coverage) can
 * reliably distinguish "this is the isolated-client-lifecycle repair's
 * own failure classification" from an ordinary query/assertion error,
 * while still exposing the original underlying error via `.cause`,
 * unmodified.
 */
export class RawClientProtocolError extends Error {
  constructor(cause: unknown) {
    const causeError = toError(cause);
    super(`isolated raw-client captured a protocol/connection error: ${causeError.message}`, { cause: causeError });
    this.name = "RawClientProtocolError";
  }
}

/**
 * Builds the single error `endIsolatedRawClient` throws when it found
 * something to report — one `RawClientProtocolError` if there was
 * exactly one contributing failure, or a flat `AggregateError` (never
 * nested) if there were several, so `.errors` always lists every
 * distinct contributing failure directly, with no caller ever needing to
 * recurse into a nested AggregateError to find them all.
 */
function buildRawClientFailure(strayErrors: unknown[], endError: unknown): Error {
  const errors = strayErrors.map((err) => new RawClientProtocolError(err));
  if (endError !== undefined) {
    errors.push(new Error(`ending the raw isolated client itself failed: ${toError(endError).message}`, { cause: toError(endError) }));
  }
  if (errors.length === 1) {
    return errors[0];
  }
  return new AggregateError(errors, `${errors.length} raw isolated-client error(s) captured during this client's connected lifetime`);
}

/**
 * Step 6-8: ends the raw client and waits for the client's own `'end'`
 * event (pg's own `Client.end()` promise resolves exactly on that event
 * — see node_modules/pg/lib/client.js) before this function's own
 * promise resolves, so a caller that awaits this is guaranteed the
 * client-side half of the connection has genuinely finished before it
 * goes on to stop the socket server / close the engine. Idempotent-safe:
 * `pg.Client.end()` itself is a documented no-op if called on a client
 * that's already ended or never connected, so this is never-double-close
 * unsafe to call twice by construction, not by an extra flag this module
 * would have to maintain independently.
 *
 * This is also the single, authoritative enforcement point for the
 * required invariant "any captured raw-client error must deterministically
 * fail the owning helper/test" (see this module's own header comment for
 * why checking `strayErrors` here, after `end()` has fully settled, is a
 * *complete* boundary, not a best-effort one). Both usage patterns pass
 * through here: the four simple callers via `withIsolatedDatabase` below,
 * and the two callers with their own migration-directory choreography by
 * calling this function directly at the end of their own `it()` body — so
 * this one function is enough to cover all six files without any of them
 * needing their own duplicated check. A failure here — whether from a
 * captured stray error, from `end()` itself throwing, or both — is never
 * downgraded to a log line; it always rejects this promise.
 */
export async function endIsolatedRawClient(rawClient: IsolatedRawClient): Promise<void> {
  let endError: unknown;
  try {
    await rawClient.end();
  } catch (err) {
    endError = err;
  }
  // Drain (not just read) so a caller that somehow inspects/awaits this
  // client again later can never double-report the same captured error.
  const captured = rawClient.strayErrors.splice(0, rawClient.strayErrors.length);
  if (captured.length === 0 && endError === undefined) {
    return;
  }
  throw buildRawClientFailure(captured, endError);
}

/**
 * Folds a newly-observed error into whatever error (if any) is already
 * being tracked as this helper invocation's own failure, without ever
 * using a throwing `finally` block to do it — a plain `try { ... } finally
 * { throw x }` would silently replace whatever the `try` block was
 * already going to throw, which is exactly the "cleanup error replaces
 * the real test failure" bug this hardening exists to prevent (see
 * `withIsolatedDatabase` below, which never lets teardown throw directly;
 * every teardown failure is caught explicitly and folded in through this
 * function instead). When there is nothing tracked yet, the new error
 * becomes the whole story, unwrapped — this is what keeps case B (a
 * callback error with no client error at all) throwing the caller's
 * original error completely unmodified, not wrapped in anything. When
 * something is already tracked, the result is always a flat (never
 * nested) `AggregateError` whose own top-level `.message` still leads
 * with the original/primary error's message, so a caller matching
 * against the thrown value's message (e.g. `.rejects.toThrow(/pattern/)`)
 * keeps working even once a second error has been folded in.
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
 * The full convenience wrapper for the four callers whose own shape is
 * "deploy the complete migration history, then run my own queries
 * against one connected client, then tear everything down" — composes
 * every step above in the exact required order. Teardown is always
 * attempted regardless of what happened earlier, and every stage's own
 * failure (the callback, ending the client, stopping the database) is
 * caught explicitly and folded together via `combineErrors` — never a
 * throwing `finally`, so a later teardown failure can never silently
 * replace an earlier, genuinely more important callback/client failure
 * (see `combineErrors`'s own doc comment for exactly why that native
 * `finally` pitfall is avoided here on purpose).
 *
 * The two callers with more complex needs (moving a migration directory
 * aside mid-test, seeding data before a partial deploy) use the lower-
 * level primitives above directly instead of this wrapper — their own
 * choreography is business logic this module deliberately knows nothing
 * about. They get the exact same deterministic-failure guarantee for
 * free, because they too must call `endIsolatedRawClient` (the single
 * enforcement point) to end their own client.
 */
export async function withIsolatedDatabase<T>(
  port: number,
  repoRoot: string,
  fn: (rawClient: IsolatedRawClient, databaseUrl: string) => Promise<T>,
): Promise<T> {
  const database = await startIsolatedDatabase(port);
  let rawClient: IsolatedRawClient | undefined;
  let primaryError: unknown;
  let result: T | undefined;

  try {
    await deployFullMigrationHistory(database.databaseUrl, repoRoot);
    rawClient = await createIsolatedRawClient(database.databaseUrl);
    try {
      result = await fn(rawClient, database.databaseUrl);
    } catch (callbackError) {
      primaryError = callbackError;
    }
  } catch (setupError) {
    primaryError = setupError;
  }

  if (rawClient) {
    try {
      await endIsolatedRawClient(rawClient);
    } catch (clientError) {
      primaryError = combineErrors(primaryError, clientError);
    }
  }

  try {
    await stopIsolatedDatabase(database);
  } catch (stopError) {
    primaryError = combineErrors(primaryError, stopError);
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }
  return result as T;
}
