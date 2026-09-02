import { readFileSync, existsSync, readdirSync } from "node:fs";
import { grep, report } from "./lib.mjs";

// AI Assistant Batch 1A + 1B.1 — this feature's own trust boundary, the
// same discipline check-search-security.mjs already established for
// Global Search: a narrow, explicit, closed set of checks over this
// batch's own files, never a broad grep that would also reject a
// legitimate doc comment mentioning a forbidden word in prose.
//
// NOTE on scope: this update deliberately does NOT touch rule 2 (the
// Platform Admin exclusion check) — its known comment-sensitivity
// weakness (found during the Batch 1A merge audit) is tracked separately
// as required hardening before request-context.ts's own auth logic is
// next modified, not something this PR's tool-registration work
// requires touching. See the Batch 1B.1 task's own explicit instruction
// not to broaden scope onto that rule.

let ok = true;

const AI_DIR = "src/lib/ai";
const REQUEST_CONTEXT_FILE = `${AI_DIR}/request-context.ts`;
const PROVIDER_FILE = `${AI_DIR}/provider.ts`;
const TOOLS_DIR = `${AI_DIR}/tools`;
const TOOLS_TYPES_FILE = `${TOOLS_DIR}/types.ts`;
const REGISTRY_FILE = `${TOOLS_DIR}/registry.ts`;
const PRIVACY_POLICY_FILE = `${AI_DIR}/privacy-policy.ts`;
const LOGGING_POLICY_FILE = `${AI_DIR}/logging-policy.ts`;

const APPROVED_TOOL_NAMES = ["getOrganizationSummary", "searchClients", "getClientDetail", "searchProjects", "searchTasks", "searchInvoices"];

// The five real tool-implementation files added across Batch 1B.1 (four)
// and Batch 1B.2 (invoices.ts) — every rule below that scans
// "provider-facing output" scans exactly these, plus tools/types.ts and
// registry.ts where relevant.
const NEW_TOOL_IMPLEMENTATION_FILES = [
  `${TOOLS_DIR}/organization-summary.ts`,
  `${TOOLS_DIR}/clients.ts`,
  `${TOOLS_DIR}/projects.ts`,
  `${TOOLS_DIR}/tasks.ts`,
  `${TOOLS_DIR}/invoices.ts`,
];

const INVOICES_FILE = `${TOOLS_DIR}/invoices.ts`;

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Strips /** ... *\/ block comments and // line comments before a
 * count-based (not grep-line-based) check — several of this file's own
 * doc comments legitimately discuss registerAiTool()/organizationId in
 * prose, and a naive substring count would misread that prose as real
 * code, the exact false-positive class check-search-security.mjs's own
 * rule 3 comment warns about.
 */
function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// 1. The AI request context module exists and exports the approved staff
// boundary function.
const requestContextContent = readIfExists(REQUEST_CONTEXT_FILE);
ok =
  report(
    "src/lib/ai/request-context.ts exists and exports getAiAssistantRequestContext",
    /export\s+async\s+function\s+getAiAssistantRequestContext/.test(requestContextContent),
    "",
  ) && ok;

// 2. Explicit Platform Admin exclusion: isPlatformAdmin() is imported from
// the canonical authorization module and actually called in the request
// context — never re-implemented (re-parsing PLATFORM_ADMIN_EMAILS a
// second time here would be a second, unaudited place that allowlist
// could drift).
//
// Hardening finding B (found during the Batch 1A merge audit, closed
// here): both sub-checks below now run against comment-stripped source,
// not the raw file content. request-context.ts's own header doc comment
// legitimately discusses "isPlatformAdmin(authUser.email)" in prose
// (explaining why the check exists and where it runs) — proven, via a
// direct reproduction during that audit, that a real regression which
// deleted the actual enforcement call while leaving that comment behind
// would still have passed this rule. stripComments() (this file's own
// established helper, already used by every other call-site rule below)
// removes exactly that prose before either regex ever runs, matching the
// same discipline the rest of this file already applies everywhere else.
const requestContextStripped = stripComments(requestContextContent);
const importsIsPlatformAdmin = /import\s*\{[^}]*\bisPlatformAdmin\b[^}]*\}\s*from\s*"@\/lib\/platform-admin\/authorization"/.test(
  requestContextStripped,
);
const callsIsPlatformAdmin = /isPlatformAdmin\(/.test(requestContextStripped);
ok = report("getAiAssistantRequestContext imports and calls the canonical isPlatformAdmin() (comment-stripped)", importsIsPlatformAdmin && callsIsPlatformAdmin, "") && ok;

// 3. No Client Portal import anywhere under src/lib/ai.
const portalImport = grep('from "@/lib/current-portal-user"', AI_DIR);
ok = report("no Client Portal import anywhere under src/lib/ai", portalImport === "", portalImport) && ok;

// 4. No Platform Admin data/query import anywhere under src/lib/ai, except
// the one reviewed exception: isPlatformAdmin from authorization.ts,
// imported only by request-context.ts.
const platformAdminImports = grep('from "@/lib/platform-admin/', AI_DIR)
  .split("\n")
  .filter(Boolean);
const disallowedPlatformAdminImports = platformAdminImports.filter((line) => {
  const [file] = line.split(":");
  const isApprovedFile = file === REQUEST_CONTEXT_FILE;
  const isApprovedModule = line.includes('"@/lib/platform-admin/authorization"');
  const isApprovedImport = line.includes("isPlatformAdmin");
  return !(isApprovedFile && isApprovedModule && isApprovedImport);
});
ok = report(
  "no Platform Admin data/query import under src/lib/ai except request-context.ts's own isPlatformAdmin() import",
  disallowedPlatformAdminImports.length === 0,
  disallowedPlatformAdminImports.join("\n"),
) && ok;

// 5. No Server Action / business-action import or directive anywhere
// under src/lib/ai — this batch has no route, no orchestration, and must
// never gain a "use server" file or an actions.ts import.
const useServerDirective = grep('"use server"', AI_DIR);
const actionsImports = grep('from ".*actions"', AI_DIR, "-E");
ok = report("no \"use server\" directive anywhere under src/lib/ai", useServerDirective === "", useServerDirective) && ok;
ok = report("no actions.ts import anywhere under src/lib/ai", actionsImports === "", actionsImports) && ok;

// 6/7. No vendor AI SDK import anywhere under src/lib/ai — this batch
// ships zero real provider adapters (only the mock), so this is
// currently a blanket rule; a future provider batch scopes vendor
// imports to providers/<vendor>.ts and updates this check accordingly.
const vendorSdkPattern = 'from "(openai|@openai/|@anthropic-ai/|@google/generative-ai|@google-cloud/vertexai|cohere-ai|@mistralai/|groq-sdk|@azure/openai)';
const vendorSdkImports = grep(vendorSdkPattern, AI_DIR);
ok = report("no vendor AI SDK import anywhere under src/lib/ai (Batch 1A ships no real provider adapter)", vendorSdkImports === "", vendorSdkImports) && ok;

// 8. Batch 1A had zero business-data tools, so this rule was originally
// "no Prisma import in tools/ at all." Batch 1B.1 genuinely needs narrow,
// org-scoped Prisma reads in clients.ts/projects.ts/tasks.ts (the
// approved architecture's own Option C) — a blanket "no Prisma" rule is
// now factually wrong, not merely outdated, so it is replaced here (a
// deliberate, explained rule change, not silently dropped) with the
// check that actually matters once real Prisma access exists: no raw/
// unrestricted query capability anywhere under src/lib/ai, matching this
// app's own existing check-no-raw-queries.mjs convention exactly.
const rawQueryPattern = "\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)";
const rawQueryUsage = grep(rawQueryPattern, AI_DIR);
ok = report("no raw/unrestricted Prisma query capability ($queryRaw*/$executeRaw*) anywhere under src/lib/ai", rawQueryUsage === "", rawQueryUsage) && ok;

// organization-summary.ts specifically must stay a pure adapter over the
// existing Dashboard reader — it should never import Prisma directly
// (its own doc comment says exactly this: Option A, full reuse).
const orgSummaryContent = readIfExists(`${TOOLS_DIR}/organization-summary.ts`);
ok = report(
  "organization-summary.ts never imports Prisma directly (reuses getDashboardAnalytics instead)",
  !/from\s*"@\/lib\/prisma"/.test(orgSummaryContent) && !/from\s*"@\/generated\/prisma/.test(orgSummaryContent),
  "",
) && ok;

// 9. The tool registry registers EXACTLY the six approved tool names — no
// more, no fewer, no substitutions. A future batch that adds real tools
// must update this specific assertion deliberately (not widen it
// silently) — it exists to keep every PR honestly scoped, not to block
// the feature from ever growing.
const registryContent = stripComments(readIfExists(REGISTRY_FILE));
const registerCallBlocks = registryContent.match(/registerAiTool\(\{[\s\S]*?\}\);/g) || [];
const registeredNames = registerCallBlocks
  .map((block) => block.match(/name:\s*"([^"]+)"/))
  .filter(Boolean)
  .map((m) => m[1]);
ok = report(
  "src/lib/ai/tools/registry.ts registers exactly the six approved tools, no more/fewer",
  JSON.stringify([...registeredNames].sort()) === JSON.stringify([...APPROVED_TOOL_NAMES].sort()),
  `registered: ${registeredNames.join(", ")}`,
) && ok;

// No mutation-like word fragment appears as a tool/file name anywhere
// under src/lib/ai/tools (defense in depth alongside mutation-guard.ts's
// own runtime check, which only runs against tools that are actually
// registered).
const MUTATION_FRAGMENTS = ["create", "update", "delete", "remove", "archive", "send", "invite", "suspend", "reactivate", "upload", "write", "mutate", "execute"];
const toolFiles = existsSync(TOOLS_DIR) ? readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts")) : [];
const suspiciousToolFileNames = toolFiles.filter((f) => {
  const base = f.replace(/\.ts$/, "");
  const fragments = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((s) => s.toLowerCase());
  return MUTATION_FRAGMENTS.some((forbidden) => fragments.includes(forbidden));
});
ok = report("no mutation-like word fragment in any src/lib/ai/tools file name", suspiciousToolFileNames.length === 0, suspiciousToolFileNames.join(", ")) && ok;

// 10. No forbidden secret-bearing field name appears anywhere under
// src/lib/ai, except inside privacy-policy.ts's own denylist (where
// naming them is the whole point) or a test file that verifies that
// denylist. Extended in Batch 1B.1 with paymentInstructions/storagePath
// (present in privacy-policy.ts's own denylist since Batch 1A but never
// added to this specific grep list — a genuine, previously-noted
// incompleteness, closed here as new tool files make it newly relevant)
// and with the Batch 1B.1 domain's own C/B-deferred field names
// (Client email/phone/notes/billing-legal identity, Project description/
// budget/ownerId, Task description/assignee).
const FORBIDDEN_FIELD_NAMES = [
  "bankName",
  "accountHolder",
  "accountNumber",
  "swiftBic",
  "paymentInstructions",
  "providerCustomerId",
  "providerSubscriptionId",
  "pdfStoragePath",
  "storagePath",
];
const forbiddenFieldPattern = `\\b(${FORBIDDEN_FIELD_NAMES.join("|")})\\b`;
const forbiddenFieldRegex = new RegExp(forbiddenFieldPattern);
// Comment-stripped per candidate file (not a raw grep) — invoices.ts's
// own doc comment legitimately discusses pdfStoragePath/paymentInstructions
// in prose explaining why they're excluded, the same false-positive class
// rule 10b (the domain-field select-scan) already guards against. Grep is
// still used as the cheap first pass to find candidate files; each
// candidate is then re-tested against its own comment-stripped content
// before being counted as a genuine hit.
const forbiddenFieldCandidateFiles = [
  ...new Set(
    grep(forbiddenFieldPattern, AI_DIR)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":")[0]),
  ),
].filter((file) => file !== PRIVACY_POLICY_FILE);
const forbiddenFieldHits = forbiddenFieldCandidateFiles.filter((file) => forbiddenFieldRegex.test(stripComments(readIfExists(file))));
ok = report(
  "no forbidden secret-bearing field name referenced under src/lib/ai outside privacy-policy.ts's own denylist (comment-stripped)",
  forbiddenFieldHits.length === 0,
  forbiddenFieldHits.join("\n"),
) && ok;

// 10b. Batch 1B.1: none of Client.notes / Project.description /
// Task.description / assignee(Email) / Client email-phone-billing-legal
// identity / Project budget-ownerId ever appear inside a Prisma `select`
// projection in any of the four new tool-implementation files.
//
// Scoped specifically to `select: { ... }` blocks (via a depth-balanced
// brace scan, not a flat regex) rather than the whole file — these files
// legitimately use the word "description" many times over as ordinary
// JSON-Schema tool-parameter metadata (e.g. `query: { type: "string",
// description: "..." }`) and as their own exported `*_DESCRIPTION`
// constants; a blanket file-wide word check would false-positive on
// every one of those. The Prisma `select` block is the one place that
// actually determines what leaves the database, so that is what this
// rule inspects.
function extractBalancedBlocks(content, openPattern) {
  const blocks = [];
  const re = new RegExp(openPattern, "g");
  let match;
  while ((match = re.exec(content))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth += 1;
      else if (content[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(content.slice(match.index, i));
  }
  return blocks;
}

const BATCH_1B1_FORBIDDEN_SELECT_FIELDS = [
  "notes",
  "email",
  "phone",
  "billingLegalName",
  "taxId",
  "streetAddress",
  "description",
  "budget",
  "ownerId",
  "assignee",
  // Batch 1B.2 — Invoice's own hard-invariant forbidden fields (none of
  // these are legitimately selected by any of the other tool files
  // either, so this stays one shared list rather than a per-file one).
  "internalNotes",
  "issuerSnapshot",
  "recipientSnapshot",
  "pdfStoragePath",
  "pdfGeneratedAt",
  "documentVersion",
  "lineItems",
  "emailAttempts",
  "pdfArchiveObjects",
  "subtotal",
  "discountType",
  "discountValue",
  "discountAmount",
  "taxRatePercent",
  "taxLabel",
  "taxAmount",
  "issueDate",
  "paidAt",
  "finalizedAt",
];
const forbiddenSelectFieldPattern = new RegExp(`\\b(${BATCH_1B1_FORBIDDEN_SELECT_FIELDS.join("|")})\\s*:`);
const domainFieldHits = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync).flatMap((file) => {
  const stripped = stripComments(readIfExists(file));
  const selectBlocks = extractBalancedBlocks(stripped, "select:\\s*\\{");
  return selectBlocks.some((block) => forbiddenSelectFieldPattern.test(block)) ? [file] : [];
});
ok = report(
  "no forbidden domain field (Client.notes/email/phone/billing-legal, Project.description/budget, Task.description/assignee, Invoice.internalNotes/issuerSnapshot/recipientSnapshot/lineItems/emailAttempts/pdfArchiveObjects/pdfStoragePath/tax-discount-internals/issueDate/paidAt/finalizedAt) appears inside a Prisma select projection in any AI tool file",
  domainFieldHits.length === 0,
  domainFieldHits.join("\n"),
) && ok;

// 10c. Batch 1B.2 invoice-specific: unlike every other tool's own search
// result (which legitimately selects `id: true` to become its own
// `ref`), invoices.ts has no detail tool and no ref at all — its own
// `id`/`organizationId`/`clientId`/`projectId` must never appear inside
// any of its own select blocks, not even the nested project/client ones.
const invoicesSelectBlocks = existsSync(INVOICES_FILE) ? extractBalancedBlocks(stripComments(readIfExists(INVOICES_FILE)), "select:\\s*\\{") : [];
const forbiddenInvoiceIdPattern = /\b(id|organizationId|clientId|projectId)\s*:/;
const invoiceIdInSelect = invoicesSelectBlocks.some((block) => forbiddenInvoiceIdPattern.test(block));
ok = report(
  "invoices.ts never selects id/organizationId/clientId/projectId — no ref exists for this tool, by design",
  !invoiceIdInSelect,
  "",
) && ok;

// 10d. No mutation-capable Prisma operation anywhere under src/lib/ai —
// defense in depth alongside the name-based mutation guard: even a
// perfectly-named read-only tool must never call a Prisma write method.
const mutationMethodPattern = "\\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\\(";
const mutationMethodUsage = grep(mutationMethodPattern, AI_DIR);
ok = report("no mutation-capable Prisma method (create/update/delete/upsert/*Many) anywhere under src/lib/ai", mutationMethodUsage === "", mutationMethodUsage) && ok;

// 10e. invoices.ts never imports invoice lifecycle/send/archive/PDF/email/
// storage/billing code — it is a pure read, and must have no path to any
// of that code even transitively through its own imports.
const forbiddenInvoiceImportPattern = 'from\\s*"@/lib/invoices/(pdf|email)|from\\s*"@/lib/billing|from\\s*".*invoices/actions"|from\\s*".*invoices/\\[id\\]/edit';
const forbiddenInvoiceImports = existsSync(INVOICES_FILE) ? grep(forbiddenInvoiceImportPattern, INVOICES_FILE) : "";
ok = report(
  "invoices.ts never imports invoice email/PDF/storage/billing/actions code",
  forbiddenInvoiceImports === "",
  forbiddenInvoiceImports,
) && ok;

// 11. organizationId is never part of a tool's model-facing public input —
// provider.ts's shared contracts never mention it at all, and
// tools/types.ts mentions it only as execute()'s explicit, non-schema
// first parameter.
const providerContent = readIfExists(PROVIDER_FILE);
ok = report("provider.ts never references organizationId (no client/model-facing field carries it)", !/organizationId/.test(providerContent), "") && ok;

const toolsTypesContent = stripComments(readIfExists(TOOLS_TYPES_FILE));
const organizationIdMentions = (toolsTypesContent.match(/organizationId/g) || []).length;
const executeParamMentions = (toolsTypesContent.match(/execute:\s*\(organizationId:/g) || []).length;
ok = report(
  "tools/types.ts mentions organizationId only as execute()'s explicit first parameter, never inside a tool's public input",
  organizationIdMentions > 0 && organizationIdMentions === executeParamMentions,
  `organizationId mentions: ${organizationIdMentions}, execute() param mentions: ${executeParamMentions}`,
) && ok;

// 11b. Batch 1B.1: organizationId legitimately appears in each tool file
// both as execute()'s own literal first parameter AND inside the real
// Prisma `where` clause it scopes (that second use is the actual
// tenant-scoping enforcement rule 11e checks for) — so unlike
// tools/types.ts (a pure type-declaration file with no query logic at
// all, where any non-parameter mention would be suspicious), the
// meaningful check here is narrower: organizationId must never appear as
// a declared property key inside any *_INPUT_SCHEMA constant (the
// model-facing surface) in any of these files.
const inputSchemaOrgIdFiles = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync).flatMap((file) => {
  const content = readIfExists(file);
  const schemaBlocks = content.match(/_INPUT_SCHEMA\s*=\s*\{[\s\S]*?\}\s*as const;/g) || [];
  return schemaBlocks.some((block) => /organizationId/.test(block)) ? [file] : [];
});
ok = report(
  "organizationId never appears as a declared property inside any Batch 1B.1 *_INPUT_SCHEMA (the model-facing surface)",
  inputSchemaOrgIdFiles.length === 0,
  inputSchemaOrgIdFiles.join("\n"),
) && ok;

const userIdMentionFiles = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync).filter((file) => /\buserId\b/.test(stripComments(readIfExists(file))));
ok = report("no Batch 1B.1 tool file ever mentions userId", userIdMentionFiles.length === 0, userIdMentionFiles.join("\n")) && ok;

// 11c. Every tool's own exported *_INPUT_SCHEMA constant sets
// additionalProperties: false — the JSON-Schema-level closed-input
// contract every tool's own runtime validator also enforces.
const inputSchemaFiles = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync);
const missingAdditionalPropertiesFalse = inputSchemaFiles.filter((file) => {
  const content = readIfExists(file);
  const schemaBlocks = content.match(/_INPUT_SCHEMA\s*=\s*\{[\s\S]*?\}\s*as const;/g) || [];
  return schemaBlocks.some((block) => !/additionalProperties:\s*false/.test(block));
});
ok = report(
  "every Batch 1B.1 *_INPUT_SCHEMA declares additionalProperties: false",
  missingAdditionalPropertiesFalse.length === 0,
  missingAdditionalPropertiesFalse.join("\n"),
) && ok;

// 11d. Result limits are fixed constants, never model-controlled — no
// tool file's own `take:` clause ever references the validated-input
// variable.
const modelControlledTakeFiles = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync).filter((file) =>
  /take:\s*(validated|input|rawInput)\b/.test(stripComments(readIfExists(file))),
);
ok = report(
  "no Batch 1B.1 tool's `take:` clause is ever derived from validated/raw input (all fixed constants)",
  modelControlledTakeFiles.length === 0,
  modelControlledTakeFiles.join("\n"),
) && ok;

// 11e. Best-effort tenant-scoping heuristic: every direct Prisma
// findMany/findFirst call in a Batch 1B.1 tool file visibly includes
// organizationId within its own where clause — a narrow, per-call-site
// proximity check (not a full parser), backed by the real integration
// tests (test/integration/ai/tools/**) as the authoritative proof.
const unscopedQueryFiles = NEW_TOOL_IMPLEMENTATION_FILES.filter(existsSync).filter((file) => {
  const stripped = stripComments(readIfExists(file));
  if (!/@\/lib\/prisma/.test(stripped)) return false; // no direct Prisma use in this file
  const calls = stripped.match(/\.(findMany|findFirst)\(\{[\s\S]{0,400}/g) || [];
  return calls.some((call) => !/organizationId/.test(call));
});
ok = report(
  "every direct Prisma findMany/findFirst call in a Batch 1B.1 tool file visibly scopes by organizationId",
  unscopedQueryFiles.length === 0,
  unscopedQueryFiles.join("\n"),
) && ok;

// 12. No console logging anywhere under src/lib/ai except inside
// logging-policy.ts's own single, metadata-only logAiAssistantEvent() —
// the same "no query/business-content logging" discipline
// check-search-security.mjs already enforces for Search, adapted here to
// allow exactly one reviewed, type-constrained exception rather than a
// blanket zero.
const consoleCalls = grep("console\\.(log|error|warn|info|debug)\\(", AI_DIR)
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.startsWith(`${LOGGING_POLICY_FILE}:`));
ok = report(
  "no console logging anywhere under src/lib/ai except logging-policy.ts's own metadata-only logAiAssistantEvent()",
  consoleCalls.length === 0,
  consoleCalls.join("\n"),
) && ok;

// 13. No AI route or UI exists yet — Batch 1A is foundation-only.
ok = report("no src/app/api/ai directory exists yet", !existsSync("src/app/api/ai"), "") && ok;
ok = report("no src/components/ai directory exists yet", !existsSync("src/components/ai"), "") && ok;

process.exit(ok ? 0 : 1);
