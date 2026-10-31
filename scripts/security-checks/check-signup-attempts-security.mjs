import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib.mjs";

// Platform Admin Growth V1, Slice A. SignupAttempt holds one platform-level
// row per Staff signup identity (email + timestamps). The boundary this
// check keeps structural rather than a code-review hope:
//
// 1. Only the recorder (src/lib/signup-attempts/record.ts) touches the
//    Prisma delegate for writes, and the only other permitted reader is
//    the guarded Platform Admin query layer. No tenant (dashboard), portal,
//    API route or action can reach the table.
// 2. The recorder never imports request-scoped data (headers, cookies,
//    FormData) and its stored fields are exactly the approved set — no
//    password, token, link, IP, user agent or Auth metadata.
// 3. The recorder's only log statement is one fixed line with a bounded
//    code — nothing identifying can be added to it unnoticed.
// 4. The Portal signup action never records a Staff attempt.
// 5. The Staff signup action records only after a successful token
//    generation, and the model's columns are exactly the approved set.

let ok = true;

const read = (f) => readFileSync(f, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : walk(full);
    return /\.(ts|tsx|mjs)$/.test(name) ? [full] : [];
  });
}

const RECORDER = "src/lib/signup-attempts/record.ts";
const ALLOWED_READERS = ["src/lib/platform-admin/queries/"];

const delegateUsers = walk("src").filter((f) => /\bsignupAttempt\b/.test(stripComments(read(f))));
const unexpected = delegateUsers.filter((f) => f !== RECORDER && !ALLOWED_READERS.some((p) => f.startsWith(p)));
ok = report(
  "only the recorder and the guarded Platform Admin query layer reference the SignupAttempt delegate",
  delegateUsers.includes(RECORDER) && unexpected.length === 0,
  unexpected.join("\n"),
) && ok;

const readerWrites = delegateUsers
  .filter((f) => ALLOWED_READERS.some((p) => f.startsWith(p)))
  .filter((f) => /\.signupAttempt\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(stripComments(read(f))));
ok = report("Platform Admin code only reads SignupAttempt — it never writes", readerWrites.length === 0, readerWrites.join("\n")) && ok;

const recorder = stripComments(read(RECORDER));
ok = report(
  "the recorder imports no request-scoped data (next/headers, cookies, FormData, Request)",
  !/from\s+["']next\/headers["']|\bcookies\s*\(|\bheaders\s*\(|\bFormData\b|\bRequest\b/.test(recorder),
  "",
) && ok;
ok = report(
  "the recorder carries no password, token, link, IP, user-agent or metadata handling",
  !/\bpassword\b|tokenHash|token_hash|confirmUrl|\bip\b|ipAddress|userAgent|user-agent|user_metadata|raw_user_meta/i.test(recorder),
  "",
) && ok;
ok = report(
  "the recorder is not a Server Action and no route handler re-exports it",
  !/^\s*["']use server["']/m.test(read(RECORDER)),
  "",
) && ok;

const consoleCalls = [...recorder.matchAll(/console\.\w+\([^;]*\);/g)].map((m) => m[0]);
ok = report(
  "the recorder's only log statement is the single fixed-shape failure line (operation + bounded code, nothing else)",
  consoleCalls.length === 1 && consoleCalls[0] === "console.warn(`[signup-attempts] ${operation} failed (${code}).`);",
  consoleCalls.join("\n"),
) && ok;

const portalFiles = walk("src/app/portal");
const portalRecorders = portalFiles.filter((f) => /signup-attempts/.test(read(f)));
ok = report("no Portal route or action imports the signup-attempts recorder", portalRecorders.length === 0, portalRecorders.join("\n")) && ok;

const recorderImporters = walk("src")
  .filter((f) => f !== RECORDER && /@\/lib\/signup-attempts\/record/.test(stripComments(read(f))))
  .sort();
ok = report(
  "the recorder is imported only by the Staff signup action and the User provisioning module",
  JSON.stringify(recorderImporters) === JSON.stringify(["src/app/(auth)/signup/actions.ts", "src/lib/current-user.ts"]),
  recorderImporters.join("\n"),
) && ok;

const staffSignup = stripComments(read("src/app/(auth)/signup/actions.ts"));
const generateAt = staffSignup.indexOf("await generateToken(");
const recordAt = staffSignup.indexOf("await recordAttempt(");
const okGuardAt = staffSignup.indexOf("if (!tokenResult.ok)");
ok = report(
  "the Staff signup action records only after generateLink succeeded, and only with the returned Auth user id",
  generateAt !== -1 && okGuardAt > generateAt && recordAt > okGuardAt && /authUserId:\s*tokenResult\.authUserId/.test(staffSignup),
  "",
) && ok;
ok = report(
  "origin is taken from the invitation token, never inferred from organization data",
  /origin:\s*invitation\s*\?\s*"INVITED"\s*:\s*"STANDALONE"/.test(staffSignup),
  "",
) && ok;

const schema = read("prisma/schema.prisma");
const model = schema.match(/model SignupAttempt \{([\s\S]*?)\n\}/);
const columns = model
  ? model[1]
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => l && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)[0])
      .sort()
  : [];
const approved = ["id", "authUserId", "email", "origin", "firstAttemptedAt", "lastAttemptedAt", "attemptCount", "activatedAt", "recordedVia", "createdAt", "updatedAt"].sort();
ok = report(
  "the SignupAttempt model has exactly the approved columns — adding any field requires updating this reviewed list",
  JSON.stringify(columns) === JSON.stringify(approved),
  columns.join(", "),
) && ok;
ok = report("SignupAttempt has no organization or tenant column (platform-level by design)", !columns.some((c) => /organization|tenant/i.test(c)), "") && ok;

process.exit(ok ? 0 : 1);
