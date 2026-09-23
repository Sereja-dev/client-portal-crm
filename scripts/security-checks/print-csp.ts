import { buildContentSecurityPolicy } from "../../next.config";

/**
 * CSP Hardening — the one bridge between check-security-headers.mjs (a
 * plain Node .mjs, no TypeScript loader of its own, matching every other
 * script in this directory) and next.config.ts's own real,
 * live-imported buildContentSecurityPolicy(). Run only via `tsx` (see
 * check-security-headers.mjs's own spawn call) so this file itself never
 * needs compiling ahead of time and next.config.ts is never duplicated
 * into a second, driftable copy. Prints both environment variants as
 * plain JSON on stdout — no file I/O, no network, no side effect.
 */
process.stdout.write(
  JSON.stringify({
    production: buildContentSecurityPolicy(false),
    development: buildContentSecurityPolicy(true),
  }),
);
