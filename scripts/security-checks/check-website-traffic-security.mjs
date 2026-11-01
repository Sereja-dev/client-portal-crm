import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib.mjs";

// Website Traffic V1. The Vercel Web Analytics integration is the only
// outbound, credentialed call in Platform Admin, so its boundary is kept
// structural:
//  1. Server-only: the token/config are read only in the query module, never
//     from a NEXT_PUBLIC_ variable, never in a Client Component.
//  2. The only host is api.vercel.com and the only path is the documented
//     visits/aggregate endpoint — no other URL, no scraping.
//  3. No fallback to the CRM's own Vercel project (VERCEL_PROJECT_ID etc.).
//  4. The module logs nothing, so a token cannot reach a log.
//  5. Nothing is fetched before the Platform Admin guard and the strict
//     activation gate.
//  6. The module is imported only by the Growth section component; the CRM
//     ships no analytics SDK of its own.

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

const MODULE = "src/lib/platform-admin/queries/website-traffic.ts";
const SECTION = "src/app/(platform-admin)/platform-admin/growth/website-traffic-section.tsx";
const CHART = "src/components/platform-admin/traffic-trend-chart.tsx";
const code = stripComments(read(MODULE));

ok = report(
  "the traffic token and config are never read from a NEXT_PUBLIC_ variable anywhere",
  !/NEXT_PUBLIC_[A-Z_]*(VERCEL_ANALYTICS|WEBSITE_TRAFFIC)/.test(walk("src").map(read).join("\n")),
  "",
) && ok;

const urls = [...code.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
ok = report(
  "the only URL in the module is the documented Vercel Web Analytics visits/aggregate endpoint",
  urls.length === 1 && urls[0] === "https://api.vercel.com/v1/query/web-analytics/visits/aggregate",
  urls.join("\n"),
) && ok;

ok = report(
  "the module never reads the CRM's own Vercel project or any ambient Vercel variable (no fallback)",
  !/process\.env\.VERCEL_(?!ANALYTICS_)|\bVERCEL_PROJECT_ID\b|\bVERCEL_URL\b|\bVERCEL_ENV\b|VERCEL_TOKEN/.test(code),
  "",
) && ok;

ok = report("the module contains no console.* call (a token cannot be logged)", !/console\./.test(code), "") && ok;

const guardAt = code.indexOf("await requirePlatformAdmin()");
const gateAt = code.indexOf("const config = readWebsiteTrafficConfig(");
const fetchAt = code.indexOf("await requestAggregate(");
ok = report(
  "requirePlatformAdmin() runs first, then the activation gate, and only then any request",
  guardAt !== -1 && gateAt > guardAt && fetchAt > gateAt,
  "",
) && ok;
ok = report(
  "activation is the strict literal WEBSITE_TRAFFIC_ENABLED === \"true\"",
  /env\.WEBSITE_TRAFFIC_ENABLED\s*!==\s*"true"/.test(code),
  "",
) && ok;
ok = report("the module is not a Server Action", !/^\s*["']use server["']/m.test(read(MODULE)), "") && ok;

const importers = walk("src")
  .filter((f) => f !== MODULE && /@\/lib\/platform-admin\/queries\/website-traffic/.test(stripComments(read(f))))
  .sort();
ok = report(
  "only the Growth section component and the chart (type import) use the traffic module",
  JSON.stringify(importers) === JSON.stringify([CHART, SECTION].sort()),
  importers.join("\n"),
) && ok;
ok = report(
  "the chart imports the module for types only, and the section is a server component",
  /import type \{[^}]*\} from "@\/lib\/platform-admin\/queries\/website-traffic"/.test(read(CHART)) &&
    !/^\s*["']use client["']/m.test(read(SECTION)),
  "",
) && ok;

const sdk = walk("src").filter((f) => /@vercel\/analytics|@vercel\/speed-insights|_vercel\/insights/.test(read(f)));
ok = report("the CRM ships no analytics SDK or insights script of its own", sdk.length === 0, sdk.join("\n")) && ok;

process.exit(ok ? 0 : 1);
