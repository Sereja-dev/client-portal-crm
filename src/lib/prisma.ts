import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// PGLITE_TEST_DB points this at the in-process PGlite database (see
// test/support/local-postgres.ts) — set by test/integration/setup-env.ts
// for the Stage 4 integration suite, and by playwright.config.ts / test/e2e/
// global-setup.ts / test/e2e/db-server.ts for the Stage 5 E2E suite's own
// separate PGlite instance. PGlite's socket server can't service more than
// one connection at a time — without capping the pool, any concurrent
// Promise.all(...) of Prisma calls (in app code or fixtures) gets its
// connection closed with "Server has closed the connection." max: 1 makes
// pg.Pool queue those calls onto one connection instead of opening several;
// behavior is identical, just serialized. Never applies against the real
// DATABASE_URL (local dev or production), where this env var is never set.
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ...(process.env.PGLITE_TEST_DB ? { max: 1 } : {}),
  });
  return new PrismaClient({ adapter });
}

/**
 * PGlite/PG-wire transaction-recovery facade — PGLITE_TEST_DB only, never
 * used in Production or ordinary development (see `createProductionPrismaClient`
 * below, byte-for-byte the same construction this file always used).
 *
 * Root cause this works around: the installed `@prisma/adapter-pg`
 * (7.9.1) releases its underlying pg-pool client unconditionally
 * (`client.release()`, no error argument) from both `PgTransaction.commit()`
 * and `.rollback()` — even when the transaction genuinely aborted. Since
 * pg-pool only destroys a connection released as unhealthy, an aborted
 * transaction's connection is recycled as if nothing happened. Under
 * PGlite's single-connection cap, the next query issued anywhere in this
 * process can then be handed a stale, wrongly-shaped result left over from
 * the aborted exchange (confirmed by direct reproduction).
 *
 * Design: a Proxy over a small, permanently-stable `overlay` object.
 * `get`/`has` check `overlay`'s own properties first — this is exactly
 * what lets `vi.spyOn(prisma, "$transaction")` (and Vitest's spy
 * machinery generally, which installs/restores via `Object.defineProperty`/
 * `Reflect.deleteProperty` on the object it's given) work completely
 * unmodified: those calls land on `overlay` via the Proxy's own default
 * (untrapped) behavior, and a subsequent `get` finds the installed mock
 * there before ever consulting the real client — a spy fully replaces
 * `$transaction` for the tests that install one (they simulate an
 * application-level rejection with no real connection involved, so there
 * is nothing for this facade to recover from), and disappears cleanly on
 * `mockRestore()`, after which real recovery resumes.
 *
 * When nothing is overlaid, every property/method forwards to a mutable
 * `currentClient`. `$transaction` is the one property this facade always
 * synthesizes itself (never delegated) when no spy has overlaid it: it
 * runs the callback against whichever client was current when the call
 * was made, and if it rejects, flags that exact client as needing
 * replacement.
 *
 * The replacement itself is deliberately LAZY, not immediate: a fresh
 * PrismaClient/pool is only ever constructed once every `$transaction`
 * call that was ever issued against the flagged client has itself
 * settled (a simple in-flight counter tracks this) — never while a
 * genuinely concurrent sibling call (e.g. two simultaneous accept-invite
 * calls racing each other via Promise.all) might still be using that same
 * physical connection. Constructing the new pool any earlier would open a
 * second live connection to PGlite's single-threaded socket server while
 * the first was possibly still mid-query — exactly the class of
 * cross-connection corruption this facade exists to prevent, not
 * reintroduce.
 *
 * A retired client is never `$disconnect()`'d in the same instant it's
 * replaced — proven necessary, not merely cautious: even a fire-and-forget
 * disconnect can still be mid-handshake with PGlite's own socket server at
 * the exact moment the freshly-constructed replacement pool opens its own
 * first connection, which is the identical single-threaded overlap this
 * whole facade exists to avoid (reproduced directly: disconnecting
 * immediately on rotation reintroduced a genuine "Cannot use a pool after
 * calling end" failure in a real concurrent-accept test). Instead, a
 * retired client is kept as `staleClient` — idle, unreferenced by any new
 * call — until the *next* rotation, at which point enough real time has
 * passed that it's disconnected safely, one generation behind. This
 * bounds simultaneously-open connections to at most two (current + one
 * stale) no matter how many rotations a single file causes, comfortably
 * inside PGlite's own `maxConnections` cap.
 */
function createPgliteRecoveryFacade(): PrismaClient {
  let currentClient = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = currentClient;
  let inFlight = 0;
  let needsRotation = false;
  // The immediately-previous generation, kept around idle for exactly one
  // more rotation before being disconnected — never disconnected in the
  // same instant it's retired (see this function's own doc comment on
  // why immediate disconnect is unsafe), but also never left open
  // forever (a test that deliberately forces many rotations in one file,
  // e.g. this fix's own regression test, would otherwise exceed PGlite's
  // `maxConnections` cap). This bounds simultaneously-open connections
  // to at most two — current and one stale — regardless of how many
  // rotations a file causes overall.
  let staleClient: PrismaClient | undefined;

  function settle(client: PrismaClient): void {
    inFlight--;
    if (inFlight === 0 && needsRotation && client === currentClient) {
      needsRotation = false;
      if (staleClient) {
        void staleClient.$disconnect().catch(() => {});
      }
      staleClient = client;
      currentClient = createPrismaClient();
      globalForPrisma.prisma = currentClient;
    }
  }

  // The stable overlay: empty until a test installs something on it
  // (spies, ad-hoc property assignment) — that installation is what
  // Vitest's own `vi.spyOn`/`mockRestore()` and any direct `prisma.x = ...`
  // naturally target once `get`/`has` check it first, using the Proxy's
  // default (untrapped) get/set/defineProperty/deleteProperty behavior.
  const overlay: Partial<PrismaClient> = {};

  function recoveryAwareTransaction(
    ...args: Parameters<PrismaClient["$transaction"]>
  ): ReturnType<PrismaClient["$transaction"]> {
    const client = currentClient;
    inFlight++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client.$transaction as any)(...args).then(
      (result: unknown) => {
        settle(client);
        return result;
      },
      (err: unknown) => {
        needsRotation = true;
        settle(client);
        throw err;
      },
    );
  }

  return new Proxy(overlay, {
    has(target, prop) {
      return Reflect.has(target, prop) || prop in currentClient;
    },
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "$transaction") {
        return recoveryAwareTransaction;
      }
      const value = Reflect.get(currentClient, prop, currentClient);
      return typeof value === "function" ? value.bind(currentClient) : value;
    },
  }) as unknown as PrismaClient;
}

function createProductionPrismaClient(): PrismaClient {
  // Cached unconditionally, not just outside production — this file is
  // one module among several separately-bundled server graphs (Server
  // Actions compile apart from Route Handlers/page renders), and each
  // graph that first imports this module gets its own fresh evaluation.
  // Without a process-wide cache, that means multiple independent
  // PrismaClient instances (each opening its own connection) even within
  // a single `next start` process, not just across dev's hot-reloads.
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma: PrismaClient = process.env.PGLITE_TEST_DB
  ? createPgliteRecoveryFacade()
  : createProductionPrismaClient();
