import { readFileSync, existsSync } from "node:fs";
import { report } from "./lib.mjs";

// Roles / Permissions V1 (architecture lock validation, locked spec
// §2/§7/§8/§9/§13/§14/§21). Structural guards for this subsystem's own
// explicit invariants: OWNER's access is immutable and unconditional
// (never override-able, never even queried), ADMIN/MEMBER access is
// organization-scoped and configurable only through the one shared
// resolver, exactly 9 permission keys exist and permission-management
// itself is never one of them, and every configurable feature delegates
// to its own exact canonical key rather than reimplementing role logic
// locally. Narrow and structural, matching this repo's own established
// per-subsystem check discipline (check-billing-security.mjs,
// check-analytics-security.mjs, check-ai-assistant-security.mjs, ...) --
// this file does not re-verify ordinary business logic already covered
// by test/integration/permissions/**, only the mechanical shape of the
// security boundary a silent refactor could otherwise erode without any
// security-check-level failure.

let ok = true;

const CATALOG_FILE = "src/lib/permissions/catalog.ts";
const RESOLVER_FILE = "src/lib/permissions/resolver.ts";
const MANAGEMENT_FILE = "src/lib/permissions/management.ts";
const AUTHORIZATION_FILE = "src/lib/permissions/authorization.ts";
const MANAGEMENT_ACTION_FILE = "src/app/(dashboard)/team/permissions/actions.ts";
const MIGRATION_FILE = "prisma/migrations/20261005000000_add_role_permission_overrides/migration.sql";
const SCHEMA_FILE = "prisma/schema.prisma";

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Extracts one named `export async function <name>(...) { ... }` body via
 * brace-depth counting (never nested ambiguously in this codebase's own
 * style) -- the same technique check-analytics-security.mjs's own
 * extractModelBlock() already uses for a Prisma model block, applied here
 * to a JS/TS function body instead. Returns null if the function isn't
 * found. Deliberately insensitive to parameter-list formatting/wrapping
 * (multi-line signatures, added/reordered parameters) -- only the
 * function NAME and its own body's brace structure matter.
 */
function extractFunctionBody(source, functionName) {
  const header = source.match(new RegExp(`export\\s+async\\s+function\\s+${functionName}\\s*\\(`));
  if (!header) return null;

  // Skip the parameter list itself via paren-depth counting first -- this
  // codebase's own destructured-parameter style (e.g.
  // `{ organizationId, role }: {...}`) means the FIRST `{` after the
  // function name is a parameter's own destructuring/type-literal brace,
  // never the function body's opening brace.
  const paramsOpenIndex = header.index + header[0].length - 1; // the "(" itself
  let parenDepth = 1;
  let j = paramsOpenIndex + 1;
  while (j < source.length && parenDepth > 0) {
    if (source[j] === "(") parenDepth++;
    else if (source[j] === ")") parenDepth--;
    j++;
  }
  // j now sits just past the parameter list's own closing ")" -- the
  // function body's opening "{" is the first brace after that (skipping
  // over a simple `: ReturnType<...>` annotation, which never itself
  // contains a "{" in this codebase's own return-type style).
  const bodyOpenIndex = source.indexOf("{", j);
  if (bodyOpenIndex === -1) return null;
  let depth = 1;
  let i = bodyOpenIndex + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(bodyOpenIndex + 1, i - 1);
}

const catalogSource = readIfExists(CATALOG_FILE);
const resolverSource = readIfExists(RESOLVER_FILE);
const managementSource = readIfExists(MANAGEMENT_FILE);
const authorizationSource = readIfExists(AUTHORIZATION_FILE);
const managementActionSource = readIfExists(MANAGEMENT_ACTION_FILE);
const migrationSource = readIfExists(MIGRATION_FILE);
const schemaSource = readIfExists(SCHEMA_FILE);

// 1. Exact permission catalog -- exactly these 9 keys, no extra, no
// missing. Protects both catalog drift (a key silently renamed/removed
// out from under a domain that still expects it) and the architecture
// rule that permission-management itself must never become one of the 9
// configurable keys (locked spec §3: "Roles / Permissions administration"
// is an immutable OWNER-only capability, not a catalog entry) -- a 10th
// key of ANY name, including a self-referential one, fails this exact-set
// check. Extracted via the array literal itself, not tied to formatting
// (one key per line, trailing commas, etc.) beyond "a quoted string
// between the array's own brackets".
const CANONICAL_PERMISSION_KEYS = [
  "ANALYTICS_VIEW",
  "REPORTS_VIEW",
  "DATA_IMPORT",
  "DATA_EXPORT",
  "RECURRING_INVOICES_MANAGE",
  "TAGS_MANAGE",
  "WORKFLOW_AUTOMATIONS_MANAGE",
  "QUOTE_TEMPLATES_MANAGE",
  "INDUSTRY_PRESETS_APPLY",
];
const catalogArrayMatch = catalogSource.match(/export const PERMISSION_KEYS = \[([\s\S]*?)\] as const;/);
const catalogArrayBody = catalogArrayMatch ? catalogArrayMatch[1] : "";
const actualPermissionKeys = [...catalogArrayBody.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
const missingCatalogKeys = CANONICAL_PERMISSION_KEYS.filter((k) => !actualPermissionKeys.includes(k));
const unexpectedCatalogKeys = actualPermissionKeys.filter((k) => !CANONICAL_PERMISSION_KEYS.includes(k));
ok = report(
  "PERMISSION_KEYS is exactly the 9 canonical keys -- no missing, no extra (permission-management itself is never a catalog key)",
  catalogArrayMatch !== null && missingCatalogKeys.length === 0 && unexpectedCatalogKeys.length === 0,
  [...missingCatalogKeys.map((k) => `missing: ${k}`), ...unexpectedCatalogKeys.map((k) => `unexpected: ${k}`)].join("\n"),
) && ok;

// 2. OWNER short-circuit precedes the override DB read, and returns the
// unconditional defaults -- OWNER must never depend on, or even reach,
// RolePermissionOverride. Ordering, not merely presence: matches this
// repo's own check-billing-security.mjs precedent (its own TEST_MODE-
// before-Paddle-activation ordering check) for exactly the same reason --
// a bare substring search cannot tell "the OWNER check runs first" apart
// from "the OWNER check exists somewhere in this file, after the query".
const effectiveSetBody = extractFunctionBody(resolverSource, "getEffectivePermissionSet");
const ownerShortCircuitIndex = effectiveSetBody
  ? effectiveSetBody.search(/if\s*\(\s*role\s*===\s*["']OWNER["']\s*\)\s*\{\s*return\s+defaults;/)
  : -1;
const overrideReadIndexInSet = effectiveSetBody ? effectiveSetBody.indexOf(".rolePermissionOverride.findMany(") : -1;
ok = report(
  "getEffectivePermissionSet's OWNER short-circuit (returning the unconditional defaults) runs before any RolePermissionOverride read",
  effectiveSetBody !== null && ownerShortCircuitIndex !== -1 && overrideReadIndexInSet !== -1 && ownerShortCircuitIndex < overrideReadIndexInSet,
  effectiveSetBody === null ? "getEffectivePermissionSet not found" : `owner short-circuit index: ${ownerShortCircuitIndex}, override read index: ${overrideReadIndexInSet}`,
) && ok;

// 3. Unknown permission key fails closed BEFORE any resolution work --
// an arbitrary/malformed permissionKey string must never reach
// getEffectivePermissionSet (and therefore never reach the override
// table) at all.
const effectivePermissionBody = extractFunctionBody(resolverSource, "getEffectivePermission");
const failClosedIndex = effectivePermissionBody
  ? effectivePermissionBody.search(/if\s*\(\s*!isPermissionKey\(permissionKey\)\s*\)\s*\{\s*return\s+false;/)
  : -1;
const delegationIndex = effectivePermissionBody ? effectivePermissionBody.indexOf("getEffectivePermissionSet(") : -1;
ok = report(
  "getEffectivePermission's isPermissionKey fail-closed check runs before getEffectivePermissionSet is ever called",
  effectivePermissionBody !== null && failClosedIndex !== -1 && delegationIndex !== -1 && failClosedIndex < delegationIndex,
  effectivePermissionBody === null ? "getEffectivePermission not found" : `fail-closed check index: ${failClosedIndex}, delegation index: ${delegationIndex}`,
) && ok;

// 4. The override read itself is organization-scoped -- the `where`
// clause of the one real RolePermissionOverride query must include both
// organizationId and role, never role alone (which would leak another
// organization's own override rows for the same role).
const findManyWhereMatch = effectiveSetBody ? effectiveSetBody.match(/\.rolePermissionOverride\.findMany\(\s*\{\s*where:\s*\{([^}]*)\}/) : null;
const findManyWhereBody = findManyWhereMatch ? findManyWhereMatch[1] : "";
ok = report(
  "the RolePermissionOverride read is scoped by both organizationId and role",
  findManyWhereMatch !== null && /\borganizationId\b/.test(findManyWhereBody) && /\brole\b/.test(findManyWhereBody),
  findManyWhereMatch === null ? "RolePermissionOverride findMany where-clause not found" : `where clause: ${findManyWhereBody.trim()}`,
) && ok;

// 5. The management write path accepts only ADMIN/MEMBER as a target
// role, and that rejection runs BEFORE any RolePermissionOverride
// mutation (deleteMany/createMany) -- an OWNER (or any other) targetRole
// must never reach a write.
const updateBody = extractFunctionBody(managementSource, "updateRolePermissions");
const targetRoleGuardIndex = updateBody
  ? updateBody.search(/if\s*\(\s*targetRole\s*!==\s*["']ADMIN["']\s*&&\s*targetRole\s*!==\s*["']MEMBER["']\s*\)/)
  : -1;
const deleteManyIndex = updateBody ? updateBody.indexOf(".rolePermissionOverride.deleteMany(") : -1;
const createManyIndex = updateBody ? updateBody.indexOf(".rolePermissionOverride.createMany(") : -1;
ok = report(
  "updateRolePermissions rejects any targetRole other than ADMIN/MEMBER before any RolePermissionOverride write",
  updateBody !== null &&
    targetRoleGuardIndex !== -1 &&
    deleteManyIndex !== -1 &&
    createManyIndex !== -1 &&
    targetRoleGuardIndex < deleteManyIndex &&
    targetRoleGuardIndex < createManyIndex,
  updateBody === null
    ? "updateRolePermissions not found"
    : `target-role guard index: ${targetRoleGuardIndex}, deleteMany index: ${deleteManyIndex}, createMany index: ${createManyIndex}`,
) && ok;

// 6. Database-level defense in depth: the hand-written CHECK constraint
// prohibiting an OWNER row must still exist in the migration (Prisma's
// schema DSL has no CHECK-constraint attribute -- this can never be
// expressed in schema.prisma itself, only in the migration SQL), and
// schema.prisma must still carry the matching intentional-drift
// documentation immediately preceding the model -- the same dual-
// documentation discipline this repo already requires for every other
// hand-written CHECK constraint, so a future `prisma migrate dev`/`diff`
// run's own false-positive DROP proposal is caught by a human, not
// silently applied.
const migrationHasCheck = /ADD CONSTRAINT "RolePermissionOverride_role_not_owner_check" CHECK \(\s*"role"\s*<>\s*'OWNER'\s*\)/.test(migrationSource);
ok = report(
  "the migration still adds RolePermissionOverride_role_not_owner_check CHECK (\"role\" <> 'OWNER')",
  migrationSource !== "" && migrationHasCheck,
  migrationSource === "" ? "migration file not found" : "CHECK constraint text not found in migration.sql",
) && ok;

const modelHeaderIndex = schemaSource.search(/^model RolePermissionOverride \{/m);
const precedingDocComment = modelHeaderIndex > 0 ? schemaSource.slice(Math.max(0, modelHeaderIndex - 2500), modelHeaderIndex) : "";
const schemaDocumentsDrift =
  /INTENTIONAL DRIFT/.test(precedingDocComment) && /RolePermissionOverride_role_not_owner_check/.test(precedingDocComment);
ok = report(
  "schema.prisma's own RolePermissionOverride doc comment still documents the hand-written CHECK as intentional drift",
  modelHeaderIndex !== -1 && schemaDocumentsDrift,
  modelHeaderIndex === -1 ? "RolePermissionOverride model not found in schema.prisma" : "intentional-drift documentation not found immediately preceding the model",
) && ok;

// 7. The one browser-reachable mutation boundary (/team/permissions'
// own Server Action) is OWNER-only, and calls the shared, dedicated
// assertion BEFORE calling into updateRolePermissions -- never trusting
// the domain layer alone to have already checked. Also confirms the
// underlying predicate itself is still exactly OWNER-only, not reused
// from, or widened to, any other domain's own authorization helper.
const actionOwnerGuardIndex = managementActionSource.indexOf("assertCanManageRolePermissions(");
const actionUpdateCallIndex = managementActionSource.indexOf("updateRolePermissions(");
ok = report(
  "updateRolePermissionsAction calls assertCanManageRolePermissions before updateRolePermissions",
  managementActionSource !== "" &&
    actionOwnerGuardIndex !== -1 &&
    actionUpdateCallIndex !== -1 &&
    actionOwnerGuardIndex < actionUpdateCallIndex,
  managementActionSource === "" ? "management action file not found" : `assertCanManageRolePermissions index: ${actionOwnerGuardIndex}, updateRolePermissions index: ${actionUpdateCallIndex}`,
) && ok;
ok = report(
  "canManageRolePermissions remains exactly OWNER-only",
  /canManageRolePermissions\(role: Role\): boolean \{\s*return role === ["']OWNER["'];\s*\}/.test(authorizationSource),
  authorizationSource === "" ? "permissions authorization file not found" : "canManageRolePermissions no longer matches the exact OWNER-only predicate",
) && ok;

// 8. Exactly the 9 configurable domains delegate to the shared resolver
// using their own exact canonical key -- this is the ONE place a
// domain's own delegation-shape guarantee lives (it deliberately
// supersedes what would otherwise be nine near-identical, independently
// maintained per-domain checks, including the Analytics-specific one this
// check now replaces). A domain reimplementing its own role === "..."
// comparison instead of delegating here would fail this, the same defect
// class Analytics itself had before Roles / Permissions V1.
const DOMAIN_DELEGATIONS = [
  { domain: "Analytics", file: "src/lib/analytics/authorization.ts", key: "ANALYTICS_VIEW" },
  { domain: "Reports", file: "src/lib/reports/authorization.ts", key: "REPORTS_VIEW" },
  { domain: "Import", file: "src/lib/import/authorization.ts", key: "DATA_IMPORT" },
  { domain: "Export", file: "src/lib/export/authorization.ts", key: "DATA_EXPORT" },
  { domain: "Recurring Invoices", file: "src/lib/recurring-invoices/recurring-invoices.ts", key: "RECURRING_INVOICES_MANAGE" },
  { domain: "Tags", file: "src/lib/tags/definitions.ts", key: "TAGS_MANAGE" },
  { domain: "Workflow Automations", file: "src/lib/workflow-automations/automations.ts", key: "WORKFLOW_AUTOMATIONS_MANAGE" },
  { domain: "Quote Templates", file: "src/lib/quote-templates/authorization.ts", key: "QUOTE_TEMPLATES_MANAGE" },
  { domain: "Industry Presets", file: "src/lib/industry-presets/authorization.ts", key: "INDUSTRY_PRESETS_APPLY" },
];
const domainFailures = DOMAIN_DELEGATIONS.filter(({ file, key }) => {
  const source = readIfExists(file);
  if (source === "") return true;
  const delegatesToResolver = new RegExp(`getEffectivePermission\\(\\s*\\{[^}]*permissionKey:\\s*["']${key}["'][^}]*\\}`).test(source);
  // A local hardcoded role comparison anywhere in the file (outside this
  // check's own reach into the shared resolver/catalog modules, which
  // this file never imports) would mean the domain reimplemented the
  // decision instead of delegating -- the exact defect class this
  // assertion exists to catch, generalized from Analytics's own prior
  // regression.
  const hasLocalRoleComparison = /role\s*===\s*["'](OWNER|ADMIN|MEMBER)["']/.test(source);
  return !delegatesToResolver || hasLocalRoleComparison;
});
ok = report(
  "each of the 9 configurable domains delegates to getEffectivePermission with its own exact canonical key, with no local role comparison",
  domainFailures.length === 0,
  domainFailures.map((d) => `${d.domain} (${d.file}) -> expected permissionKey "${d.key}"`).join("\n"),
) && ok;

// 9. No per-user (or per-portal-user) override shape exists on
// RolePermissionOverride -- Roles / Permissions V1 is role-scoped only
// (locked spec: "no per-user overrides"). Scoped specifically to this
// one model's own field block, not a repo-wide userId sweep -- a
// userId/membershipId/portalUserId-shaped column on an unrelated model
// is none of this check's concern.
function extractModelBlock(source, modelName) {
  const header = source.match(new RegExp(`^model\\s+${modelName}\\s*\\{`, "m"));
  if (!header) return null;
  const bodyStart = header.index + header[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(bodyStart, i - 1);
}
function stripLineComments(body) {
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}
function fieldNames(cleanedBody) {
  return cleanedBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0]);
}
const overrideBlock = extractModelBlock(schemaSource, "RolePermissionOverride");
const overrideFields = overrideBlock ? fieldNames(stripLineComments(overrideBlock)) : [];
const REQUIRED_OVERRIDE_FIELDS = ["organizationId", "role", "permissionKey", "allowed"];
const FORBIDDEN_USER_SCOPED_FIELD_PATTERN = /userId|membershipId|portalUserId/i;
const missingRequiredFields = REQUIRED_OVERRIDE_FIELDS.filter((f) => !overrideFields.includes(f));
const forbiddenUserScopedFields = overrideFields.filter((f) => FORBIDDEN_USER_SCOPED_FIELD_PATTERN.test(f));
ok = report(
  "RolePermissionOverride has organizationId/role/permissionKey/allowed and no per-user-scoped field (userId/membershipId/portalUserId)",
  overrideBlock !== null && missingRequiredFields.length === 0 && forbiddenUserScopedFields.length === 0,
  overrideBlock === null
    ? "RolePermissionOverride model not found"
    : [...missingRequiredFields.map((f) => `missing: ${f}`), ...forbiddenUserScopedFields.map((f) => `forbidden: ${f}`)].join("\n"),
) && ok;

process.exit(ok ? 0 : 1);
