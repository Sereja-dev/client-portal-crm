import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

// Quotes / Estimates Phase 2, extended by Phase 2.3 (Quote -> Invoice
// conversion) and Phase 4 (Client Portal approval/decline — the second
// file below). Mirrors check-leads-security.mjs's own exact discipline
// and reasoning for the same invariants, applied to every file that
// exports a Quote-mutating Server Action, staff or Portal alike.

let ok = true;

const ACTIONS_FILES = [
  "src/app/(dashboard)/quotes/actions.ts",
  "src/app/portal/(app)/quotes/actions.ts",
];

for (const ACTIONS_FILE of ACTIONS_FILES) {
  const content = readFileSync(ACTIONS_FILE, "utf8");

  // 1. organizationId is only ever a local variable destructured from
  // getCurrentUserOrganization()/getCurrentPortalUser() — never accepted
  // as a parameter of one of this file's own *exported* actions (the
  // attacker-reachable entry points), which would mean a caller could
  // supply it directly.
  const organizationIdAsParam = /\bexport\s+async\s+function\s+\w+\s*\([^)]*\borganizationId\s*:/.test(content);
  ok = report(`[${ACTIONS_FILE}] no exported Quote action accepts organizationId as a parameter`, !organizationIdAsParam, "") && ok;

  // 2. convertedInvoiceId is never a parameter of one of this file's own
  // exported actions — convertQuoteToInvoiceAction only ever writes it via
  // its own internal, guarded updateMany (never accepts it as caller
  // input).
  const convertedInvoiceIdAsParam = /\bexport\s+async\s+function\s+\w+\s*\([^)]*\bconvertedInvoiceId\s*:/.test(content);
  ok = report(`[${ACTIONS_FILE}] no exported Quote action accepts convertedInvoiceId as a parameter`, !convertedInvoiceIdAsParam, "") && ok;

  // 3. Only the org-scoped, compound-where forms are used against the
  // Quote model (updateMany/findFirst/create) — never the single-record
  // update()/delete()/findUnique() forms, which take a unique-by-id-alone
  // filter that a copy-pasted future call site could forget to also scope
  // by organizationId (staff file) or clientId+organizationId (Portal file).
  const unsafeSingleRecordCalls = ["\\.quote\\.update\\(", "\\.quote\\.delete\\(", "\\.quote\\.findUnique\\("];
  const foundUnsafeCalls = unsafeSingleRecordCalls.filter((pattern) => new RegExp(pattern).test(content));
  ok = report(
    `[${ACTIONS_FILE}] Quote mutations only ever use scoped updateMany/findFirst/create, never the single-record update/delete/findUnique forms`,
    foundUnsafeCalls.length === 0,
    foundUnsafeCalls.join(", "),
  ) && ok;

  // 4. Quotes / Estimates Phase 2.3 — convertQuoteToInvoiceAction must
  // never accept clientId as a parameter (the new Invoice's clientId
  // always comes from the re-fetched Quote's own clientId, never from the
  // caller) — a forged clientId could otherwise attach the resulting
  // Invoice to an arbitrary Client this Staff member never selected. The
  // Portal file's own approve/decline actions must equally never accept
  // clientId — it always comes from getCurrentPortalUser() alone.
  const clientIdAsParam = /\bexport\s+async\s+function\s+\w+\s*\([^)]*\bclientId\s*:/.test(content);
  ok = report(`[${ACTIONS_FILE}] no exported Quote action accepts clientId as a parameter`, !clientIdAsParam, "") && ok;
}

process.exit(ok ? 0 : 1);
