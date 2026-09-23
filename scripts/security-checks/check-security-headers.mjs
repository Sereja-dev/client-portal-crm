import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { report } from "./lib.mjs";

/**
 * CSP Hardening (read-only architecture audit, then this narrow
 * implementation) — the one deterministic regression check for this
 * app's entire browser security-header surface, previously
 * unprotected: before this file, nothing anywhere in the repo asserted
 * anything about Content-Security-Policy or the other headers
 * next.config.ts sets (confirmed by the audit's own repo-wide search).
 *
 * Validates the ACTUAL configured header source, not a hardcoded
 * duplicate: spawns `tsx` against print-csp.ts, which imports
 * next.config.ts's own real, exported buildContentSecurityPolicy() and
 * calls it with both isDevelopment values — the exact same function
 * next.config.ts's own `headers()` uses at request time. A future edit
 * to that function is what this check re-evaluates, never a second,
 * independently-maintained copy of the policy string that could drift
 * silently out of sync with the real one.
 *
 * Two-process design (mirrors check-integration-exit-code.mjs's own
 * `execFileSync` subprocess pattern): this plain .mjs script has no
 * TypeScript loader of its own, matching every other file in this
 * directory, so the one file that needs to import next.config.ts's
 * named export runs under `tsx` instead — a real, already-installed
 * dependency this repo already uses elsewhere for the same reason
 * (scripts/ai-provider-eval/), not a new one introduced here.
 */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const PRINT_CSP_SCRIPT = join(SCRIPT_DIR, "print-csp.ts");

let ok = true;

let production;
let development;
try {
  const output = execFileSync(TSX_BIN, [PRINT_CSP_SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  ({ production, development } = JSON.parse(output));
} catch (err) {
  console.error(`[check-security-headers] Failed to evaluate next.config.ts's own buildContentSecurityPolicy(): ${err.message}`);
  process.exit(1);
}

// A. Production CSP — required directives present, exactly as
// next.config.ts's own buildContentSecurityPolicy(false) computes them.
const REQUIRED_DIRECTIVE_SUBSTRINGS = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "upgrade-insecure-requests",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
];
for (const substring of REQUIRED_DIRECTIVE_SUBSTRINGS) {
  ok = report(`Production CSP contains "${substring}"`, production.includes(substring), production) && ok;
}
ok = report("Production CSP does NOT contain 'unsafe-eval'", !production.includes("'unsafe-eval'"), production) && ok;

// B. Development CSP — 'unsafe-eval' present (React dev-mode needs it),
// and every other directive unchanged from Production (this build only
// ever varies script-src's own trailing 'unsafe-eval').
ok = report("Development CSP contains 'unsafe-eval'", development.includes("'unsafe-eval'"), development) && ok;
for (const substring of REQUIRED_DIRECTIVE_SUBSTRINGS) {
  ok = report(`Development CSP also contains "${substring}"`, development.includes(substring), development) && ok;
}

// C. Regression constraints — no wildcard/generic-scheme reintroduction,
// checked against the Production policy (the one actually served to
// real visitors).
const hasBareWildcard = production
  .split(";")
  .map((directive) => directive.trim())
  .some((directive) => directive.split(/\s+/).slice(1).includes("*"));
ok = report("Production CSP contains no bare '*' source value in any directive", !hasBareWildcard, production) && ok;
ok = report("Production CSP contains no generic http: source", !production.includes(" http:") && !production.includes("'http:'"), production) && ok;

const imgSrcDirective = production.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src")) ?? "";
ok = report("Production CSP's img-src contains no generic https: source (only the scoped Supabase origin)", !/(?:^|\s)https:(?:\s|$)/.test(imgSrcDirective), imgSrcDirective) && ok;

const fontSrcDirective = production.split(";").map((d) => d.trim()).find((d) => d.startsWith("font-src")) ?? "";
ok = report("Production CSP's font-src contains no generic https: source", !/(?:^|\s)https:(?:\s|$)/.test(fontSrcDirective), fontSrcDirective) && ok;

// D. Other security headers — read straight from next.config.ts's own
// source text (the same static-analysis convention every other
// check-*.mjs file in this directory already uses), rather than a
// second hardcoded copy of their values.
const nextConfigSource = readFileSync(join(REPO_ROOT, "next.config.ts"), "utf8");
ok = report('next.config.ts sets X-Frame-Options: DENY', /key:\s*"X-Frame-Options",\s*value:\s*"DENY"/.test(nextConfigSource), "") && ok;
ok = report('next.config.ts sets X-Content-Type-Options: nosniff', /key:\s*"X-Content-Type-Options",\s*value:\s*"nosniff"/.test(nextConfigSource), "") && ok;
ok = report(
  'next.config.ts sets Referrer-Policy: strict-origin-when-cross-origin',
  /key:\s*"Referrer-Policy",\s*value:\s*"strict-origin-when-cross-origin"/.test(nextConfigSource),
  "",
) && ok;

const PERMISSIONS_POLICY_DIRECTIVES = ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "accelerometer=()", "gyroscope=()", "magnetometer=()"];
const permissionsPolicyMatch = nextConfigSource.match(/PERMISSIONS_POLICY = \[([\s\S]*?)\]\.join/);
const permissionsPolicyBlock = permissionsPolicyMatch ? permissionsPolicyMatch[1] : "";
const permissionsPolicyQuotedValues = [...permissionsPolicyBlock.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
ok = report(
  "next.config.ts's Permissions-Policy contains exactly the expected directives, no more, no fewer",
  permissionsPolicyQuotedValues.length === PERMISSIONS_POLICY_DIRECTIVES.length &&
    PERMISSIONS_POLICY_DIRECTIVES.every((directive) => permissionsPolicyQuotedValues.includes(directive)),
  permissionsPolicyQuotedValues.join(", "),
) && ok;

// Deliberately does NOT assert Strict-Transport-Security: that header is
// supplied by Vercel's own platform defaults, never set in this app's
// own source — asserting it here would test infrastructure this repo
// doesn't own or control, not this file's own configuration.

console.log(`\n${ok ? "All" : "Not all"} security-header checks passed.`);
process.exit(ok ? 0 : 1);
