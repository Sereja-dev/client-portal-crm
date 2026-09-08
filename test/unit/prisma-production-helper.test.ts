import { describe, expect, it, vi } from "vitest";
import {
  loadProductionEnv,
  resolvePrismaArgs,
  runProductionPrismaCommand,
  SUPPORTED_COMMANDS,
  PRODUCTION_ENV_FILENAME,
} from "../../scripts/prisma-production.mjs";

/**
 * Pre-Launch Audit F2 (Prisma CLI env-loading ambiguity) hardening,
 * extended by Database Environment Safety Phase 2 — covers
 * scripts/prisma-production.mjs entirely through dependency injection. No
 * real .env.production.db.local, no real database, and no real child
 * process is ever touched here — every fixture below is a synthetic
 * sentinel value, never a real credential shape. Every test below passes
 * its own explicit `envFilePath` (never relying on the real default), so
 * only the one dedicated test right below actually asserts what that
 * default filename is.
 */

describe("PRODUCTION_ENV_FILENAME", () => {
  it("is .env.production.db.local, never .env.production.local — that filename is one of Next.js's own reserved, auto-loaded env-file names (see this script's own header comment, part 2)", () => {
    expect(PRODUCTION_ENV_FILENAME).toBe(".env.production.db.local");
  });
});

const SENTINEL_DATABASE_URL = "postgres://sentinel-db-value";
const SENTINEL_DIRECT_URL = "postgres://sentinel-direct-value";
const STALE_DATABASE_URL = "postgres://stale-inherited-database-value";
const STALE_DIRECT_URL = "postgres://stale-inherited-direct-value";

function fakeFs(fileContent: string | null) {
  return {
    fileExists: vi.fn(() => fileContent !== null),
    readFile: vi.fn(() => {
      if (fileContent === null) throw new Error("readFile called on a nonexistent file");
      return fileContent;
    }),
  };
}

describe("loadProductionEnv", () => {
  it("A: production-file values win over conflicting inherited (stale) values", () => {
    const { fileExists, readFile } = fakeFs(
      `DATABASE_URL=${SENTINEL_DATABASE_URL}\nDIRECT_URL=${SENTINEL_DIRECT_URL}\n`,
    );
    const inheritedEnv = {
      DATABASE_URL: STALE_DATABASE_URL,
      DIRECT_URL: STALE_DIRECT_URL,
      PATH: "/usr/bin",
    };

    const result = loadProductionEnv({ envFilePath: "/fake/.env.production.local", inheritedEnv, fileExists, readFile });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.env.DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    expect(result.env.DIRECT_URL).toBe(SENTINEL_DIRECT_URL);
    // Non-conflicting inherited entries are preserved, not dropped.
    expect(result.env.PATH).toBe("/usr/bin");
  });

  it("B: fails when the production env file does not exist, before ever reading it", () => {
    const { fileExists, readFile } = fakeFs(null);

    const result = loadProductionEnv({
      envFilePath: "/fake/.env.production.local",
      inheritedEnv: {},
      fileExists,
      readFile,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toContain("/fake/.env.production.local");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("C: fails when DIRECT_URL is absent from the production file", () => {
    const { fileExists, readFile } = fakeFs(`DATABASE_URL=${SENTINEL_DATABASE_URL}\n`);

    const result = loadProductionEnv({ envFilePath: "/fake/.env.production.local", inheritedEnv: {}, fileExists, readFile });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toContain("DIRECT_URL");
    expect(result.error).not.toContain("DATABASE_URL:");
  });

  it("D: fails when DATABASE_URL is absent from the production file", () => {
    const { fileExists, readFile } = fakeFs(`DIRECT_URL=${SENTINEL_DIRECT_URL}\n`);

    const result = loadProductionEnv({ envFilePath: "/fake/.env.production.local", inheritedEnv: {}, fileExists, readFile });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toContain("DATABASE_URL");
  });

  it("F: no error message ever contains a sentinel credential value", () => {
    const missingBoth = loadProductionEnv({
      envFilePath: "/fake/.env.production.local",
      inheritedEnv: {},
      ...fakeFs(""),
    });
    expect(missingBoth.ok).toBe(false);
    if (missingBoth.ok) throw new Error("expected ok:false");
    expect(missingBoth.error).not.toContain(SENTINEL_DATABASE_URL);
    expect(missingBoth.error).not.toContain(SENTINEL_DIRECT_URL);
    expect(missingBoth.error).not.toContain(STALE_DATABASE_URL);
    expect(missingBoth.error).not.toContain(STALE_DIRECT_URL);

    const missingFileError = loadProductionEnv({
      envFilePath: "/fake/.env.production.local",
      inheritedEnv: { DATABASE_URL: STALE_DATABASE_URL, DIRECT_URL: STALE_DIRECT_URL },
      ...fakeFs(null),
    }).error;
    expect(missingFileError).not.toContain(STALE_DATABASE_URL);
    expect(missingFileError).not.toContain(STALE_DIRECT_URL);
  });
});

describe("resolvePrismaArgs", () => {
  it("maps 'status' and 'deploy' to the exact, narrow prisma argv", () => {
    expect(resolvePrismaArgs("status")).toEqual({ ok: true, args: ["migrate", "status"] });
    expect(resolvePrismaArgs("deploy")).toEqual({ ok: true, args: ["migrate", "deploy"] });
  });

  it("E: rejects any command outside the narrow supported set — never a passthrough", () => {
    for (const bad of ["reset", "dev", "db push", "", undefined, "status; rm -rf /"]) {
      const result = resolvePrismaArgs(bad as string);
      expect(result.ok, `expected "${bad}" to be rejected`).toBe(false);
    }
  });

  it("the supported command set is exactly {status, deploy} — no more, no fewer", () => {
    expect(Object.keys(SUPPORTED_COMMANDS).sort()).toEqual(["deploy", "status"]);
  });
});

describe("runProductionPrismaCommand — full orchestration via dependency injection", () => {
  function baseDeps(fileContent: string | null, extraInheritedEnv: Record<string, string> = {}) {
    const { fileExists, readFile } = fakeFs(fileContent);
    const spawn = vi.fn();
    // NODE_ENV is only here to satisfy NodeJS.ProcessEnv's shape (inferred
    // for runProductionPrismaCommand's inheritedEnv parameter from its own
    // `= process.env` default) — not itself part of what any test asserts.
    const inheritedEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", ...extraInheritedEnv };
    return { fileExists, readFile, spawn, inheritedEnv };
  }

  it("happy path: spawns the repository-local Prisma CLI exactly once, with the merged env and the exact mapped argv, and never on the shell's PATH", () => {
    const { fileExists, readFile, spawn, inheritedEnv } = baseDeps(
      `DATABASE_URL=${SENTINEL_DATABASE_URL}\nDIRECT_URL=${SENTINEL_DIRECT_URL}\n`,
      { DATABASE_URL: STALE_DATABASE_URL, DIRECT_URL: STALE_DIRECT_URL },
    );

    const result = runProductionPrismaCommand({
      command: "status",
      repoRoot: "/fake/repo",
      envFilePath: "/fake/repo/.env.production.local",
      inheritedEnv,
      fileExists,
      readFile,
      spawn,
      prismaCliPath: "/fake/repo/node_modules/prisma/build/index.js",
      execPath: "/fake/node",
    });

    expect(result).toEqual({ ok: true, exitCode: 0 });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe("/fake/node");
    expect(args).toEqual(["/fake/repo/node_modules/prisma/build/index.js", "migrate", "status"]);
    expect(options.cwd).toBe("/fake/repo");
    expect(options.env.DATABASE_URL).toBe(SENTINEL_DATABASE_URL);
    expect(options.env.DIRECT_URL).toBe(SENTINEL_DIRECT_URL);
  });

  it("B: never spawns Prisma when the production env file is missing", () => {
    const { fileExists, readFile, spawn, inheritedEnv } = baseDeps(null);

    const result = runProductionPrismaCommand({
      command: "status",
      repoRoot: "/fake/repo",
      envFilePath: "/fake/repo/.env.production.local",
      inheritedEnv,
      fileExists,
      readFile,
      spawn,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("C/D: never spawns Prisma when a required variable is missing", () => {
    const { fileExists, readFile, spawn, inheritedEnv } = baseDeps(`DATABASE_URL=${SENTINEL_DATABASE_URL}\n`);

    const result = runProductionPrismaCommand({
      command: "deploy",
      repoRoot: "/fake/repo",
      envFilePath: "/fake/repo/.env.production.local",
      inheritedEnv,
      fileExists,
      readFile,
      spawn,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("DIRECT_URL");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("E: an unsupported command is rejected before ever checking the env file or spawning anything", () => {
    const { fileExists, readFile, spawn, inheritedEnv } = baseDeps(
      `DATABASE_URL=${SENTINEL_DATABASE_URL}\nDIRECT_URL=${SENTINEL_DIRECT_URL}\n`,
    );

    const result = runProductionPrismaCommand({
      command: "reset",
      repoRoot: "/fake/repo",
      envFilePath: "/fake/repo/.env.production.local",
      inheritedEnv,
      fileExists,
      readFile,
      spawn,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported command");
    expect(fileExists).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("propagates the child process's real exit code on failure, never masking it as a generic 1", () => {
    const { fileExists, readFile, inheritedEnv } = baseDeps(
      `DATABASE_URL=${SENTINEL_DATABASE_URL}\nDIRECT_URL=${SENTINEL_DIRECT_URL}\n`,
    );
    const failingSpawn = vi.fn(() => {
      const err = Object.assign(new Error("Command failed"), { status: 7 });
      throw err;
    });

    const result = runProductionPrismaCommand({
      command: "status",
      repoRoot: "/fake/repo",
      envFilePath: "/fake/repo/.env.production.local",
      inheritedEnv,
      fileExists,
      readFile,
      spawn: failingSpawn,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });

  it("F: no returned error ever contains a sentinel or stale credential value, across every failure path", () => {
    const cases: Array<Record<string, unknown>> = [
      { command: "status", ...baseDeps(null, { DATABASE_URL: STALE_DATABASE_URL, DIRECT_URL: STALE_DIRECT_URL }) },
      { command: "status", ...baseDeps(`DATABASE_URL=${SENTINEL_DATABASE_URL}\n`) },
      { command: "not-a-real-command", ...baseDeps(`DATABASE_URL=${SENTINEL_DATABASE_URL}\nDIRECT_URL=${SENTINEL_DIRECT_URL}\n`) },
    ];

    for (const testCase of cases) {
      const result = runProductionPrismaCommand({
        repoRoot: "/fake/repo",
        envFilePath: "/fake/repo/.env.production.local",
        ...testCase,
      } as Parameters<typeof runProductionPrismaCommand>[0]);

      expect(result.ok).toBe(false);
      const message = String(result.error);
      expect(message).not.toContain(SENTINEL_DATABASE_URL);
      expect(message).not.toContain(SENTINEL_DIRECT_URL);
      expect(message).not.toContain(STALE_DATABASE_URL);
      expect(message).not.toContain(STALE_DIRECT_URL);
    }
  });
});
