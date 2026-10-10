#!/usr/bin/env node
// Platform Admin Credential / Recovery Hardening. The trusted-operator
// counterpart to the app-level recovery block added to
// src/lib/auth/password-reset.ts: since an allowlisted Platform Admin
// identity no longer receives an Aqenra-issued recovery token/email
// through the public forgot-password flow, this is the one supported
// way to set/rotate that identity's own Supabase Auth password instead.
//
// Deliberately NOT a route, Server Action, UI page, API endpoint, or
// deploy-time hook — a plain Node script, run manually from a trusted
// operator's own local/CI-adjacent shell, where the real
// SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL/PLATFORM_ADMIN_EMAILS values
// this app already uses are already present in the environment (the
// exact same names the application and src/lib/supabase/admin-client.ts
// already read — never a new variable name invented for this script).
//
// Deliberately does NOT import src/lib/supabase/admin-client.ts or the
// generated Prisma Client. Both are TypeScript sources this repo's own
// `tsx`-based operator runner (scripts/ai-smoke/openai-live.ts) only
// ever loads under the `--conditions=react-server` flag — that flag
// exists specifically to let `import "server-only"` (which admin-client.ts
// carries) resolve to a no-op instead of throwing outside Next's own
// bundler. scripts/prisma-production.mjs, this script's own direct
// precedent, is instead a bare, dependency-light, zero-TS-loader .mjs —
// matching that same shape here (narrowly re-constructing the identical
// service-role client via the already-installed @supabase/supabase-js
// package directly, and resolving the target identity via one
// parameterized, read-only SQL query through the already-installed `pg`
// package) avoids needing either a TS loader or that flag at all, and
// introduces no second general-purpose Prisma/Supabase abstraction —
// just the one factory call and the one query, inlined.
//
// Never logs, prints, stores, or echoes the new password at any point —
// see readMaskedLine()'s own doc comment and every call site below.

import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client: PgClient } = pg;

/**
 * Mirrors src/lib/platform-admin/authorization.ts's own parseAdminEmails()/
 * isPlatformAdmin() exactly — deliberately duplicated here, never
 * imported, because that module is part of the Next.js app's own Server
 * Component/Action module graph (it also imports "react"'s cache() and
 * "next/navigation"'s redirect()), which this standalone operator script
 * must never depend on. Same "duplicated here rather than imported"
 * convention src/lib/auth/password-reset.ts's own MIN_PASSWORD_LENGTH
 * doc comment already documents elsewhere in this exact codebase. A
 * future change to the real allowlist's parsing rules must be mirrored
 * here by hand — a small, deliberate cost for keeping this script fully
 * independent of the app's own module graph.
 */
export function isAllowlistedPlatformAdminEmail(normalizedEmail, rawAllowlistEnvValue) {
  const allowlist = new Set(
    (rawAllowlistEnvValue ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowlist.has(normalizedEmail);
}

/** Same floor src/lib/auth/password-reset.ts's own resetPasswordCore() enforces — duplicated for the identical reason MIN_PASSWORD_LENGTH is duplicated there rather than imported. */
export const MIN_PASSWORD_LENGTH = 8;

/** The only environment variable NAMES this script ever reads — every one already used elsewhere in this exact application; no new runtime configuration is introduced. */
export const REQUIRED_ENV_VARS = ["PLATFORM_ADMIN_EMAILS", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];

/** Never includes a value in the returned error — only variable NAMES. */
export function validateOperatorEnv(env) {
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    return { ok: false, error: `Missing required operator environment variable(s): ${missing.join(", ")}.` };
  }
  return { ok: true };
}

/**
 * One target per invocation (locked spec §9 — "do not support bulk
 * rotation"). Accepts either `--email value` or `--email=value`; rejects
 * a missing, blank, or more-than-once-given email rather than guessing
 * which one was meant.
 */
export function parseArgs(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") {
      values.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--email=")) {
      values.push(arg.slice("--email=".length));
    }
  }
  if (values.length === 0) {
    return { ok: false, error: "Missing required --email <address> argument." };
  }
  if (values.length > 1) {
    return { ok: false, error: "Multiple --email values given; provide exactly one target." };
  }
  const email = (values[0] ?? "").trim();
  if (!email) {
    return { ok: false, error: "The --email argument cannot be blank." };
  }
  return { ok: true, email: email.toLowerCase() };
}

/** Same three checks resetPasswordCore() already applies to a self-service reset — this tool must never accept a weaker password than the app's own normal flow would. */
export function validatePasswordInput(password, confirmPassword) {
  if (!password || !confirmPassword) {
    return { ok: false, error: "Both password prompts are required." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "The two password entries did not match." };
  }
  return { ok: true, password };
}

/**
 * The entire orchestration, with every I/O-touching step injected
 * (mirrors scripts/prisma-production.mjs's own runProductionPrismaCommand()
 * shape exactly) — so the full decision sequence, including that a
 * non-allowlisted target is rejected BEFORE any lookup/mutation dependency
 * is ever invoked, is deterministically testable with no real Postgres,
 * no real Supabase, and no real password ever involved.
 *
 * Order is the whole point of the fail-closed guarantee (locked spec
 * §12): env validation, THEN the allowlist check, THEN (only if
 * allowlisted) the identity lookup, THEN operator confirmation, THEN the
 * password prompt, and ONLY THEN the Supabase mutation. A target that
 * fails the allowlist check never reaches `deps.findUserIdByEmail` at
 * all — not just "never reaches the mutation" — so an ordinary Staff
 * email can never cause so much as a lookup through this tool.
 */
export async function rotatePlatformAdminPassword({ targetEmail, env, deps }) {
  const envResult = validateOperatorEnv(env);
  if (!envResult.ok) {
    return { ok: false, error: envResult.error };
  }

  if (!isAllowlistedPlatformAdminEmail(targetEmail, env.PLATFORM_ADMIN_EMAILS)) {
    return {
      ok: false,
      error: `"${targetEmail}" is not currently listed in PLATFORM_ADMIN_EMAILS. Refusing to change its password.`,
    };
  }

  const userId = await deps.findUserIdByEmail(targetEmail);
  if (!userId) {
    return { ok: false, error: `No existing User found for "${targetEmail}". This tool never creates an account.` };
  }

  const confirmed = await deps.confirmAction(targetEmail);
  if (!confirmed) {
    return { ok: false, error: "Cancelled — no change was made." };
  }

  let passwordInput;
  try {
    passwordInput = await deps.promptPassword();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read a password securely." };
  }

  const passwordResult = validatePasswordInput(passwordInput.password, passwordInput.confirmPassword);
  if (!passwordResult.ok) {
    return { ok: false, error: passwordResult.error };
  }

  const updateResult = await deps.updateUserPassword(userId, passwordResult.password);
  if (!updateResult.ok) {
    return { ok: false, error: "Supabase rejected the password update. No change was applied." };
  }

  return { ok: true, email: targetEmail };
}

// ---------------------------------------------------------------------
// Real, I/O-touching dependency implementations — every one above is
// injected so the orchestration tests never reach any of these. These
// two are themselves further broken out with their own one-level-deeper
// injection seam (`createPgClient`/`createAdminClient`), so a focused
// test can prove connection cleanup and the exact Supabase call shape
// with a fake client object — never a real network call.
// ---------------------------------------------------------------------

/** One parameterized, read-only lookup — never writes, never a LIKE/wildcard match, never resolves more than exactly the row for this one normalized email. The connection is always closed, including when `query()` itself throws. */
export async function findUserIdByEmail(email, env, deps = {}) {
  const createPgClient = deps.createPgClient ?? ((connectionString) => new PgClient({ connectionString }));
  const client = createPgClient(env.DATABASE_URL);
  await client.connect();
  try {
    const result = await client.query('SELECT id FROM "User" WHERE email = $1 LIMIT 1', [email]);
    return result.rows[0]?.id ?? null;
  } finally {
    await client.end();
  }
}

function askLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function realConfirmAction(email) {
  console.log("");
  console.log(`Target identity: ${email}`);
  console.log("This identity must already be listed in PLATFORM_ADMIN_EMAILS (already verified).");
  console.log("This will set a NEW Supabase Auth password for this identity. The current password will stop working immediately.");
  console.log("");
  const answer = await askLine('Type "yes" to continue, or anything else to cancel: ');
  return answer.trim().toLowerCase() === "yes";
}

/**
 * Masked, non-echoed terminal input — writes nothing to the screen as
 * the operator types (not even a placeholder character), so a password
 * is never visible in a terminal recording/screen-share and never left
 * in scrollback. Requires a real TTY; refuses outright otherwise (locked
 * spec §10 — "fail closed in non-interactive mode"), since a
 * non-interactive invocation would mean the password came from argv, an
 * env var, or a pipe — exactly what this tool must never accept. No new
 * package dependency — built from node:readline's own raw-mode support,
 * the smallest mechanism that satisfies "masked/non-echoed," already
 * zero-dependency per the locked spec's own instruction.
 */
function readMaskedLine(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("A real interactive terminal is required to enter a password. Refusing to proceed."));
      return;
    }

    process.stdout.write(promptText);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let input = "";

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    }

    function onData(char) {
      const text = char.toString();
      if (text === "\n" || text === "\r") {
        cleanup();
        process.stdout.write("\n");
        resolve(input);
        return;
      }
      if (text === "\u0003") {
        // Ctrl+C — restore the terminal before this process actually exits.
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Cancelled."));
        return;
      }
      if (text === "\u007f" || text === "\b") {
        input = input.slice(0, -1);
        return;
      }
      input += text;
    }

    stdin.on("data", onData);
  });
}

async function realPromptPassword() {
  const password = await readMaskedLine("New password: ");
  const confirmPassword = await readMaskedLine("Confirm new password: ");
  return { password, confirmPassword };
}

/**
 * Narrowly re-constructs the exact same service-role client
 * src/lib/supabase/admin-client.ts's own getSupabaseAuthAdminClient()
 * builds (identical two env var names, identical auth options) — see
 * this file's own header comment for why that module itself is not
 * imported directly. Returns only a boolean — the raw Supabase
 * response/error object is deliberately never handed back to the
 * orchestrator above, so there is no code path by which a caller could
 * ever print it.
 */
export async function updateUserPassword(userId, password, env, deps = {}) {
  const createAdminClient =
    deps.createAdminClient ?? ((url, key, options) => createClient(url, key, options));
  const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  return { ok: !error };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const argsResult = parseArgs(process.argv.slice(2));
  if (!argsResult.ok) {
    console.error(`[platform-admin-set-password] ${argsResult.error}`);
    process.exit(1);
  }

  const env = process.env;
  rotatePlatformAdminPassword({
    targetEmail: argsResult.email,
    env,
    deps: {
      findUserIdByEmail: (email) => findUserIdByEmail(email, env),
      confirmAction: realConfirmAction,
      promptPassword: realPromptPassword,
      updateUserPassword: (userId, password) => updateUserPassword(userId, password, env),
    },
  })
    .then((result) => {
      if (!result.ok) {
        console.error(`[platform-admin-set-password] ${result.error}`);
        process.exit(1);
      }
      console.log(`[platform-admin-set-password] Password updated for ${result.email}.`);
      process.exit(0);
    })
    .catch(() => {
      console.error("[platform-admin-set-password] Unexpected failure. No change should be assumed to have been applied.");
      process.exit(1);
    });
}
