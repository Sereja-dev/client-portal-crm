import { existsSync, readFileSync } from "node:fs";
import { grep, report } from "./lib.mjs";

// TEST_MODE (src/lib/test-mode.ts) bypasses real Supabase Auth entirely —
// it must never be settable by anything that runs in a real deployment.
// Every check below targets a DIFFERENT way that could accidentally
// happen; passing all of them is what "the E2E harness cannot leak into
// production" actually means in practice, not just a claim in a comment.

let ok = true;

// 1. No committed env/deploy config ever sets TEST_MODE to a truthy value.
// (E2E's own playwright.config.ts setting it for its own webServer is
// fine and expected — this checks everything ELSE.)
const committedConfigFiles = [".env.example", "vercel.json", "package.json"];
for (const file of committedConfigFiles) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, "utf8");
  const hasBadAssignment = /TEST_MODE\s*[=:]\s*["']?1["']?/.test(content);
  ok = report(`${file} never sets TEST_MODE`, !hasBadAssignment, hasBadAssignment ? `Found a TEST_MODE=1-shaped assignment in ${file}.` : "") && ok;
}

// 2. The gating check itself exists in exactly one place (src/lib/
// test-mode.ts) — every consumer must import TEST_MODE from there, never
// redefine its own `process.env.TEST_MODE` check (which could drift, e.g.
// a typo'd comparison that's accidentally always true).
const rawChecks = grep('process\\.env\\.TEST_MODE', "src/");
const rawCheckLines = rawChecks
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.startsWith("src/lib/test-mode.ts:"));
ok = report(
  "process.env.TEST_MODE is only ever read in src/lib/test-mode.ts",
  rawCheckLines.length === 0,
  rawCheckLines.join("\n"),
) && ok;

// 3. Every src/** importer of the shared gate is accounted for, in BOTH
// directions — expectedConsumers is exhaustive, not a spot-checked
// subset: any file that imports TEST_MODE from "@/lib/test-mode" belongs
// here, no exemption for a test-only/mock surface (its own TEST_MODE
// check is frequently the ONLY thing keeping it unreachable in a real
// deployment, so it needs this guarantee at least as much as a
// security-critical consumer does — never hardcode NODE_ENV/TEST_MODE
// logic of its own instead). Mirrors rule 7's own bidirectional
// missing+unexpected shape exactly, so a future PR that adds a new
// TEST_MODE consumer without registering it here fails loudly instead of
// silently drifting the way this list once did (it grew from 7 entries to
// 22 actual consumers, one-directionally unnoticed, before this rule was
// hardened).
const consumers = grep("from \"@/lib/test-mode\"", "src/");
const consumerFiles = consumers
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split(":")[0]);
const uniqueConsumerFiles = [...new Set(consumerFiles)];
const expectedConsumers = [
  "src/app/(dashboard)/layout.tsx",
  "src/app/api/e2e-test-storage/[...path]/route.ts",
  "src/app/auth/confirm/route.ts",
  "src/app/billing/mock/checkout/actions.ts",
  "src/app/billing/mock/checkout/page.tsx",
  "src/app/billing/mock/portal/actions.ts",
  "src/app/billing/mock/portal/page.tsx",
  "src/app/test-only/theme/page.tsx",
  "src/lib/ai/providers/provider-factory.ts",
  "src/lib/auth/recovery-token.ts",
  "src/lib/billing/provider/mock-provider.ts",
  "src/lib/billing/provider/provider.ts",
  "src/lib/email/resend-client.ts",
  "src/lib/integrations/slack-client.ts",
  "src/lib/invoices/email/trusted-origin.ts",
  "src/lib/invoices/pdf/logo.ts",
  "src/lib/invoices/pdf/storage.ts",
  "src/lib/storage/attachments-storage.ts",
  "src/lib/storage/logo-storage.ts",
  "src/lib/storage/test-storage.ts",
  "src/lib/supabase/middleware.ts",
  "src/lib/supabase/server.ts",
];
const missingConsumers = expectedConsumers.filter((f) => !uniqueConsumerFiles.includes(f));
const unexpectedConsumers = uniqueConsumerFiles.filter((f) => !expectedConsumers.includes(f));
ok = report(
  "expectedConsumers exactly matches every actual src/** importer of the shared TEST_MODE gate (bidirectional)",
  missingConsumers.length === 0 && unexpectedConsumers.length === 0,
  [...missingConsumers.map((f) => `missing: ${f}`), ...unexpectedConsumers.map((f) => `unexpected: ${f}`)].join("\n"),
) && ok;

// 4. The test-only cookie name never appears in a .tsx file (this app's
// Client Components) — it should only ever be read/written server-side.
const clientLeaks = grep("x_e2e_test_user", "src/", "--include=*.tsx");
ok = report("the test-mode cookie name never appears in a .tsx (client-reachable) file", clientLeaks === "", clientLeaks) && ok;

// 5. The E2E test-storage serving route (the TEST_MODE analog of the
// Auth bypass, for attachment Storage — see src/lib/storage/test-storage.ts)
// must reject every request before it ever reads the in-memory store,
// unless TEST_MODE is on. A textual "TEST_MODE appears before the store
// read, in the same file" check is a deliberately blunt proxy for "this
// 404s first" — good enough to catch someone reordering the guard below
// the read, which no amount of import-only checking (#3) would catch.
const routeFile = "src/app/api/e2e-test-storage/[...path]/route.ts";
if (existsSync(routeFile)) {
  const content = readFileSync(routeFile, "utf8");
  const guardIndex = content.indexOf("TEST_MODE");
  const readIndex = content.indexOf("testStorageRead(");
  const guardsFirst = guardIndex !== -1 && readIndex !== -1 && guardIndex < readIndex;
  ok = report(
    `${routeFile} checks TEST_MODE before reading the test store`,
    guardsFirst,
    guardsFirst ? "" : "Expected a TEST_MODE check textually before the testStorageRead(...) call.",
  ) && ok;
} else {
  ok = report(`${routeFile} exists`, false, "Expected the E2E test-storage serving route to exist.") && ok;
}

// 6. Nothing under src/ imports test/ code — the boundary the whole
// TEST_MODE design depends on (production code branches on an env var;
// it never reaches into test/ for behavior). A stray import here would
// mean actual test helpers (fixtures, PGlite, db-server) ship in the app
// bundle, not just an inert flag. Matches any relative-path depth
// ("../test/", "../../../test/", ...), not just one or two levels up.
const testImports = grep('from "([^"]*/)?test/', "src/");
ok = report("no file under src/ imports from test/", testImports === "", testImports) && ok;

// 7. src/lib/storage/test-storage.ts (the Storage analog of TEST_MODE's
// identity bypass) is imported only by the two call sites that actually
// gate it on TEST_MODE — checked separately from #3's "imports the shared
// gate" list, since a file could theoretically import test-storage
// directly without ever importing test-mode.ts at all.
const storageImporters = grep('from "\\./test-storage"|from "@/lib/storage/test-storage"', "src/")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split(":")[0]);
const expectedStorageImporters = [
  "src/lib/storage/attachments-storage.ts",
  "src/lib/storage/logo-storage.ts",
  "src/app/api/e2e-test-storage/[...path]/route.ts",
  // Invoice System Slice 3, sub-PR 3b — same TEST_MODE-gated in-memory
  // Storage stand-in, for the new private invoice-pdf namespace and its
  // logo-byte reads respectively.
  "src/lib/invoices/pdf/storage.ts",
  "src/lib/invoices/pdf/logo.ts",
];
const uniqueStorageImporters = [...new Set(storageImporters)];
const unexpectedStorageImporters = uniqueStorageImporters.filter((f) => !expectedStorageImporters.includes(f));
const missingStorageImporters = expectedStorageImporters.filter((f) => !uniqueStorageImporters.includes(f));
ok = report(
  `test-storage is imported only by its expected consumers (${expectedStorageImporters.join(", ")})`,
  unexpectedStorageImporters.length === 0 && missingStorageImporters.length === 0,
  [...unexpectedStorageImporters.map((f) => `unexpected: ${f}`), ...missingStorageImporters.map((f) => `missing: ${f}`)].join("\n"),
) && ok;

process.exit(ok ? 0 : 1);
