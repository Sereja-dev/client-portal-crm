#!/usr/bin/env node
// Pre-Launch Audit F2 (Prisma CLI env-loading ambiguity), extended by
// Database Environment Safety Phase 2 — the one safe, explicit path for
// running Prisma migration commands against Production.
//
// Two separate problems this closes:
//
// 1. `prisma.config.ts` imports bare "dotenv/config", which only ever
//    auto-loads a plain `.env` file — never any of the files below. A
//    plain `npx prisma migrate status`/`deploy` therefore silently reads
//    whatever stale DATABASE_URL/DIRECT_URL happens to be in `.env`/
//    `.env.local`/the inherited shell environment instead — what caused
//    real operator confusion during the Production database
//    password-rotation incident this hardening originally followed.
//
// 2. Phase 2: `.env.production.local` (this script's original choice)
//    turned out to be unsafe for a second, independent reason — it's one
//    of Next.js's own reserved env-file names, auto-loaded during any
//    LOCAL "production mode" run (`npm run build`, `next build`,
//    `next start`). Keeping real Production credentials there meant an
//    ordinary local build silently received them too, defeating the
//    isolation this script exists to guarantee. Production credentials
//    now live in `.env.production.db.local` instead — a filename that
//    does not match any of Next.js's exact reserved patterns
//    (`.env`, `.env.local`, `.env.$(NODE_ENV)`, `.env.$(NODE_ENV).local`),
//    so Next.js never auto-loads it under any NODE_ENV.
//
// This script is the fix for both: it refuses to run at all unless
// `.env.production.db.local` genuinely exists and defines both required
// variables, and it always spawns the repository-local Prisma CLI with an
// explicitly constructed environment where the production file's values
// win over anything already set (never `.env`, never `.env.local`, never
// the old `.env.production.local`, never an inherited shell value) — so a
// stale or accidentally-set value can never silently take over.
//
// Deliberately narrow: only "status" and "deploy" are accepted (mapped to
// `prisma migrate status`/`prisma migrate deploy`) — this is not a
// generic arbitrary-Prisma-command passthrough.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(SCRIPT_DIR, "..");
// Deliberately NOT `.env.production.local` — see this file's own header
// comment, part 2. `.env.production.db.local` matches none of Next.js's
// reserved env-file patterns, so it is never auto-loaded by
// `npm run dev`/`npm run build`/`next start` — only by this script.
export const PRODUCTION_ENV_FILENAME = ".env.production.db.local";
export const REQUIRED_VARS = ["DATABASE_URL", "DIRECT_URL"];

/** The only two operations this helper will ever run — never a passthrough. */
export const SUPPORTED_COMMANDS = {
  status: ["migrate", "status"],
  deploy: ["migrate", "deploy"],
};

/**
 * Loads the production env file (already resolved to `envFilePath`) via
 * dotenv's own `parse()` — never `dotenv.config()`, so nothing here ever
 * touches `process.env` directly — merges it on top of `inheritedEnv`
 * (production-file values always win: this is the explicit override this
 * helper exists to guarantee), and validates every one of `requiredVars`
 * is present in the result.
 *
 * Returns a fresh merged object for the caller to pass directly as a
 * child process's own `env`; never mutates `inheritedEnv`. `fileExists`/
 * `readFile` are injectable so tests can point this at a synthetic
 * fixture instead of a real credential file.
 *
 * Never includes a variable's value in any returned error message — only
 * the file path and, on a missing-variable failure, the variable's name.
 */
export function loadProductionEnv({
  envFilePath,
  inheritedEnv,
  requiredVars = REQUIRED_VARS,
  fileExists = existsSync,
  readFile = (path) => readFileSync(path, "utf8"),
}) {
  if (!fileExists(envFilePath)) {
    return {
      ok: false,
      error:
        `Production env file not found: ${envFilePath}\n` +
        `Refusing to fall back to any other .env file for a Production Prisma command.`,
    };
  }

  const parsed = dotenv.parse(readFile(envFilePath));
  const mergedEnv = { ...inheritedEnv, ...parsed };

  const missing = requiredVars.filter((key) => !mergedEnv[key]);
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `Missing required variable(s) in ${envFilePath}: ${missing.join(", ")}\n` +
        `Refusing to run any Prisma command against Production with an incomplete configuration.`,
    };
  }

  return { ok: true, env: mergedEnv };
}

/** Maps the narrow, supported command name to its exact `prisma` argv — never a passthrough of arbitrary arguments. */
export function resolvePrismaArgs(command) {
  const args = SUPPORTED_COMMANDS[command];
  if (!args) {
    const supported = Object.keys(SUPPORTED_COMMANDS).join(", ");
    return {
      ok: false,
      error: `Unsupported command "${command ?? ""}". Supported commands: ${supported}.`,
    };
  }
  return { ok: true, args };
}

/**
 * Orchestrates one Production Prisma CLI invocation end to end. Every
 * I/O-touching dependency (filesystem, the actual child-process spawn) is
 * injectable, so this entire flow — including the decision of *whether*
 * to spawn Prisma at all — is testable without a real .env.production.local,
 * a real database, or a real child process.
 */
export function runProductionPrismaCommand({
  command,
  repoRoot = REPO_ROOT,
  envFilePath = join(repoRoot, PRODUCTION_ENV_FILENAME),
  inheritedEnv = process.env,
  fileExists = existsSync,
  readFile = (path) => readFileSync(path, "utf8"),
  spawn = (bin, args, options) => execFileSync(bin, args, options),
  prismaCliPath = join(repoRoot, "node_modules/prisma/build/index.js"),
  execPath = process.execPath,
}) {
  const argsResult = resolvePrismaArgs(command);
  if (!argsResult.ok) {
    return { ok: false, error: argsResult.error, exitCode: 1 };
  }

  const envResult = loadProductionEnv({ envFilePath, inheritedEnv, fileExists, readFile });
  if (!envResult.ok) {
    return { ok: false, error: envResult.error, exitCode: 1 };
  }

  try {
    spawn(execPath, [prismaCliPath, ...argsResult.args], {
      cwd: repoRoot,
      env: envResult.env,
      stdio: "inherit",
    });
    return { ok: true, exitCode: 0 };
  } catch (err) {
    // execFileSync throws on a non-zero child exit (or spawn failure) —
    // only the numeric exit status is ever read off the error here, never
    // the error object itself (which Node populates with the argv, not
    // any secret, but there is no reason to print it regardless).
    const exitCode = typeof err?.status === "number" ? err.status : 1;
    return { ok: false, error: "Prisma command exited with a non-zero status.", exitCode };
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const result = runProductionPrismaCommand({ command: process.argv[2] });
  if (!result.ok && result.error) {
    console.error(`[prisma-production] ${result.error}`);
  }
  process.exit(result.exitCode);
}
