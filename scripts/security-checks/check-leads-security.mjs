import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

// Leads / Sales Pipeline Phase 2. Every Lead mutation must resolve
// organizationId server-side and scope every lookup/write by it — the
// same tenant-isolation discipline check-search-security.mjs's own
// "check for the absence of a risky pattern" style already establishes
// for a different feature. Deliberately narrow (three checks, each a
// simple substring/regex match against one file) rather than a general
// "every Prisma call is org-scoped" analyzer — that would need real
// parsing to do reliably, not a regex.

let ok = true;

const ACTIONS_FILE = "src/app/(dashboard)/leads/actions.ts";
const content = readFileSync(ACTIONS_FILE, "utf8");

// 1. organizationId is only ever a local variable destructured from
// getCurrentUserOrganization()/getCurrentMembership() — never accepted
// as a parameter of one of this file's own *exported* actions (the
// attacker-reachable entry points), which would mean a caller (and
// therefore, eventually, a client) could supply it directly. Scoped to
// `export async function` specifically — this file's own private
// verifyAssigneeInOrganization() helper legitimately takes organizationId
// as a parameter (always called with an already-trusted, server-resolved
// value), and is deliberately not what this check is about.
const organizationIdAsParam = /\bexport\s+async\s+function\s+\w+\s*\([^)]*\borganizationId\s*:/.test(content);
ok = report("no exported Lead action accepts organizationId as a parameter", !organizationIdAsParam, "") && ok;

// 2. convertedClientId is only ever set as a write value (data: {
// convertedClientId: client.id, ... } inside convertLeadToClientAction's
// own transaction) — never a parameter of one of this file's own
// exported actions, which would mean a caller could point conversion at
// an arbitrary existing Client.
const convertedClientIdAsParam = /\bexport\s+async\s+function\s+\w+\s*\([^)]*\bconvertedClientId\s*:/.test(content);
ok = report("no exported Lead action accepts convertedClientId as a parameter", !convertedClientIdAsParam, "") && ok;

// 3. Only the org-scoped, compound-where forms are used against the Lead
// model (updateMany/findFirst/create, every call site in this file
// already includes organizationId in its own where/data) — never the
// single-record update()/delete()/findUnique() forms, which take a
// unique-by-id-alone filter that a copy-pasted future call site could
// forget to also scope by organizationId.
const unsafeSingleRecordCalls = ["\\.lead\\.update\\(", "\\.lead\\.delete\\(", "\\.lead\\.findUnique\\("];
const foundUnsafeCalls = unsafeSingleRecordCalls.filter((pattern) => new RegExp(pattern).test(content));
ok = report(
  "Lead mutations only ever use organizationId-scoped updateMany/findFirst/create, never the single-record update/delete/findUnique forms",
  foundUnsafeCalls.length === 0,
  foundUnsafeCalls.join(", "),
) && ok;

process.exit(ok ? 0 : 1);
