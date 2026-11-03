import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { startIsolatedDatabase, stopIsolatedDatabase } from "../../support/isolated-postgres";

/**
 * Regression coverage for recurring `listen EADDRINUSE 127.0.0.1:55xxx`
 * failures in the isolated-PGlite integration tests: those tests used to bind
 * hardcoded ports inside Linux's ephemeral range, where a port can already be
 * taken by the time a test binds it. startIsolatedDatabase() now binds an
 * OS-assigned port and builds its URL from the port the server actually
 * reports.
 *
 * This proves the helper avoids an occupied port; it does not prove the exact
 * kernel mechanism behind the historical failures. The occupied port here is
 * itself obtained from the OS (never a hardcoded shared port), so this file
 * cannot collide with anything either.
 */

async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (blocker.address() as net.AddressInfo).port;
  return { port, release: () => new Promise<void>((resolve) => blocker.close(() => resolve())) };
}

function connectionRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED"));
  });
}

/** PGlite.close() delegates internally, so one close shows up as more than one spy call; what matters is that it ran and every instance it ran on is now closed. */
function expectEngineClosed(closeSpy: { mock: { calls: unknown[]; contexts: unknown[] } }): void {
  expect(closeSpy.mock.calls.length).toBeGreaterThan(0);
  for (const instance of closeSpy.mock.contexts) {
    expect((instance as PGlite).closed).toBe(true);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startIsolatedDatabase uses an OS-assigned port", () => {
  it("starts while the requested port is occupied, reports the real port in its URL, serves queries, and releases everything on stop", async () => {
    const occupied = await occupyPort();
    try {
      // The original approach: binding the occupied port directly fails.
      const bare = new PGlite();
      const bareServer = new PGLiteSocketServer({ db: bare, host: "127.0.0.1", port: occupied.port, maxConnections: 5 });
      await expect(bareServer.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
      await bareServer.stop().catch(() => undefined);
      await bare.close().catch(() => undefined);

      // The helper, handed the very same occupied port, still starts.
      const database = await startIsolatedDatabase(occupied.port);
      let actualPort = 0;
      try {
        actualPort = Number(new URL(database.databaseUrl).port);
        expect(actualPort).toBeGreaterThan(0);
        expect(actualPort).not.toBe(occupied.port);
        expect(database.socketServer.getServerConn()).toBe(`127.0.0.1:${actualPort}`);
        expect(database.databaseUrl).toBe(`postgresql://postgres@127.0.0.1:${actualPort}/postgres`);

        // A real client can connect through the returned URL and query.
        const client = new pg.Client({ connectionString: database.databaseUrl });
        await client.connect();
        try {
          const result = await client.query("SELECT 1 AS one");
          expect(result.rows).toEqual([{ one: 1 }]);
          const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname");
          expect(roles.rows.map((row) => row.rolname)).toEqual(["anon", "authenticated"]);
        } finally {
          await client.end();
        }
      } finally {
        await stopIsolatedDatabase(database);
      }

      // Cleanup released both the listener and the engine.
      expect(await connectionRefused(actualPort)).toBe(true);
      expect(database.pglite.closed).toBe(true);
    } finally {
      await occupied.release();
    }
  });

  it("gives two concurrently running isolated databases two different ports, ignoring identical requests", async () => {
    const first = await startIsolatedDatabase(55999);
    const second = await startIsolatedDatabase(55999);
    try {
      expect(new URL(first.databaseUrl).port).not.toBe(new URL(second.databaseUrl).port);
    } finally {
      await stopIsolatedDatabase(first);
      await stopIsolatedDatabase(second);
    }
  });
});

describe("startIsolatedDatabase startup-failure cleanup", () => {
  it("closes the engine and rethrows the original error when the server fails to start", async () => {
    const closeSpy = vi.spyOn(PGlite.prototype, "close");
    vi.spyOn(PGLiteSocketServer.prototype, "start").mockRejectedValueOnce(new Error("SYNTHETIC_START_FAILURE"));

    await expect(startIsolatedDatabase()).rejects.toThrow("SYNTHETIC_START_FAILURE");
    expectEngineClosed(closeSpy);
  });

  it("stops a server that did start, releasing its listener, when a later startup step fails", async () => {
    const stopSpy = vi.spyOn(PGLiteSocketServer.prototype, "stop");
    const closeSpy = vi.spyOn(PGlite.prototype, "close");
    let startedConnection = "";
    const realStart = PGLiteSocketServer.prototype.start;
    vi.spyOn(PGLiteSocketServer.prototype, "start").mockImplementation(async function (this: PGLiteSocketServer) {
      await realStart.call(this);
      startedConnection = this.getServerConn();
    });
    // Fail only the role-creation step, which runs after the server is listening;
    // PGlite may issue other internal queries earlier, so those pass through.
    const realQuery = PGlite.prototype.query as (this: PGlite, ...args: unknown[]) => Promise<unknown>;
    vi.spyOn(PGlite.prototype, "query").mockImplementation(function (this: PGlite, ...args: unknown[]) {
      if (typeof args[0] === "string" && args[0].startsWith("CREATE ROLE anon")) {
        return Promise.reject(new Error("SYNTHETIC_ROLE_FAILURE"));
      }
      return realQuery.apply(this, args);
    } as unknown as typeof PGlite.prototype.query);

    await expect(startIsolatedDatabase()).rejects.toThrow("SYNTHETIC_ROLE_FAILURE");

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expectEngineClosed(closeSpy);
    const port = Number(startedConnection.slice(startedConnection.lastIndexOf(":") + 1));
    expect(port).toBeGreaterThan(0);
    expect(await connectionRefused(port)).toBe(true);
  });

  it("preserves the original startup error even when the cleanup itself fails", async () => {
    const original = new Error("SYNTHETIC_START_FAILURE_WITH_BROKEN_CLEANUP");
    vi.spyOn(PGLiteSocketServer.prototype, "start").mockRejectedValueOnce(original);
    vi.spyOn(PGLiteSocketServer.prototype, "stop").mockRejectedValueOnce(new Error("SYNTHETIC_STOP_FAILURE"));
    vi.spyOn(PGlite.prototype, "close").mockRejectedValueOnce(new Error("SYNTHETIC_CLOSE_FAILURE"));

    await expect(startIsolatedDatabase()).rejects.toBe(original);
  });
});
