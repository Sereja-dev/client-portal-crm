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
// weakness (found during the Batch 1A merge audit) was closed by a
// dedicated, separate hardening PR (see this rule's own comment-stripped
// implementation below) before this file's own next real touch, which is
// this one: the AI Assistant orchestration + Route Handler batch, adding
// checks 14-30 below for the new /api/ai/assistant route and the new
// src/lib/ai/{orchestrate,system-prompt,orchestration-limits,
// request-schema,providers/{provider-factory,unconfigured-provider}}.ts
// files. Rule 13's own prior wording ("no src/app/api/ai directory
// exists yet") is updated here too — a deliberate, explained rule
// change, the same discipline rule 8's own earlier Prisma-import-rule
// inversion already established — not a silent drop.

let ok = true;

const AI_DIR = "src/lib/ai";
const REQUEST_CONTEXT_FILE = `${AI_DIR}/request-context.ts`;
const PROVIDER_FILE = `${AI_DIR}/provider.ts`;
const TOOLS_DIR = `${AI_DIR}/tools`;
const TOOLS_TYPES_FILE = `${TOOLS_DIR}/types.ts`;
const REGISTRY_FILE = `${TOOLS_DIR}/registry.ts`;
const PRIVACY_POLICY_FILE = `${AI_DIR}/privacy-policy.ts`;
const LOGGING_POLICY_FILE = `${AI_DIR}/logging-policy.ts`;

// Orchestration + Route Handler batch.
const API_AI_DIR = "src/app/api/ai";
const APPROVED_ROUTE_FILE = `${API_AI_DIR}/assistant/route.ts`;
const ORCHESTRATE_FILE = `${AI_DIR}/orchestrate.ts`;
const REQUEST_SCHEMA_FILE = `${AI_DIR}/request-schema.ts`;
const ORCHESTRATION_LIMITS_FILE = `${AI_DIR}/orchestration-limits.ts`;
const SYSTEM_PROMPT_FILE = `${AI_DIR}/system-prompt.ts`;
const PROVIDERS_DIR = `${AI_DIR}/providers`;
const PROVIDER_FACTORY_FILE = `${PROVIDERS_DIR}/provider-factory.ts`;
const UNCONFIGURED_PROVIDER_FILE = `${PROVIDERS_DIR}/unconfigured-provider.ts`;

// Staff AI Assistant drawer/UI batch.
const COMPONENTS_AI_DIR = "src/components/ai";
const TRIGGER_FILE = `${COMPONENTS_AI_DIR}/ai-assistant-trigger.tsx`;
const PANEL_FILE = `${COMPONENTS_AI_DIR}/ai-assistant-panel.tsx`;
const AI_CLIENT_FILE = `${AI_DIR}/client.ts`;
const HEADER_FILE = "src/components/layout/header.tsx";
const DASHBOARD_LAYOUT_FILE = "src/app/(dashboard)/layout.tsx";
const PORTAL_DIR = "src/app/portal";
const PLATFORM_ADMIN_DIR = "src/app/(platform-admin)";

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

// 6/7. No vendor AI SDK import anywhere under src/lib/ai EXCEPT the one
// approved real adapter file, providers/openai.ts — a deliberate,
// explained rule change (the same discipline rule 8's own earlier
// Prisma-import-rule inversion already established, not a silent drop):
// this batch adds the first real provider adapter, so the prior blanket
// "zero vendor SDK imports anywhere" rule is now factually wrong, not
// merely outdated. The narrowed rule below still catches the thing that
// actually matters — a vendor SDK import creeping into orchestrate.ts,
// route.ts, provider-factory.ts, or any tool file, which would mean a
// raw SDK object could reach code this app trusts to normalize vendor
// output that never happened.
const vendorSdkPattern = 'from "(openai|@openai/|@anthropic-ai/|@google/generative-ai|@google-cloud/vertexai|cohere-ai|@mistralai/|groq-sdk|@azure/openai)';
const OPENAI_PROVIDER_FILE = `${PROVIDERS_DIR}/openai.ts`;
const vendorSdkImportLines = grep(vendorSdkPattern, AI_DIR)
  .split("\n")
  .filter(Boolean)
  .filter((line) => line.split(":")[0] !== OPENAI_PROVIDER_FILE);
ok = report(
  "no vendor AI SDK import anywhere under src/lib/ai except the one approved real adapter, providers/openai.ts",
  vendorSdkImportLines.length === 0,
  vendorSdkImportLines.join("\n"),
) && ok;

// The approved adapter genuinely does import the openai SDK (this rule
// would otherwise pass vacuously if that file were ever emptied out or
// renamed without anyone noticing) — comment-stripped, matching every
// other declaration-shaped rule in this file.
const openaiProviderContent = stripComments(readIfExists(OPENAI_PROVIDER_FILE));
ok = report(
  'providers/openai.ts genuinely imports the "openai" SDK (comment-stripped)',
  /from\s*"openai"/.test(openaiProviderContent),
  "",
) && ok;

// No raw OpenAI SDK type/object ever appears in this adapter's own
// exported surface — complete() must return only AiResponse (kind:"text"
// or kind:"toolCall"), never an SDK ChatCompletion object itself, and
// every caught error is normalized to AiProviderError before it can
// escape. A blunt but effective proxy: the file's own return/throw
// statements are scanned, never "completion"/"choice"/raw SDK error
// class names appearing in a return/throw position.
const rawSdkEscapePattern = /\b(return|throw)\s+completion\b|\breturn\s+choice\b/;
ok = report(
  "providers/openai.ts never returns/throws a raw SDK response object directly",
  !rawSdkEscapePattern.test(openaiProviderContent),
  "",
) && ok;

// providers/openai.ts never logs anything (console.*) — any operator
// diagnostics for this adapter flow through orchestrate.ts's own single
// metadata-only logAiAssistantEvent() call site (rule 24 below), never a
// second, unaudited log line inside the adapter itself that could carry
// a raw SDK error/request detail.
const consoleInOpenAiProvider = grep("console\\.(log|error|warn|info|debug)\\(", OPENAI_PROVIDER_FILE);
ok = report("providers/openai.ts never logs anything itself", consoleInOpenAiProvider === "", consoleInOpenAiProvider) && ok;

// The adapter never reads AQENRA_OPENAI_API_KEY (or any env var) itself —
// openai-config.ts is the one place that reads it; the key only ever
// reaches this file as an explicit function parameter, never a second,
// independent env read that could drift from the validated config.
ok = report("providers/openai.ts never reads process.env directly (the key arrives only as an explicit parameter)", !/process\.env/.test(openaiProviderContent), "") && ok;

// The adapter always explicitly pins its own baseURL, neutralizing the
// SDK's own OPENAI_BASE_URL env-var fallback (see this file's own header
// comment) — never constructs the client with an implicit/unset baseURL.
ok = report("providers/openai.ts always explicitly pins baseURL (neutralizing the SDK's own OPENAI_BASE_URL env fallback)", /baseURL:\s*OPENAI_BASE_URL/.test(openaiProviderContent), "") && ok;

// openai-config.ts (the one file that reads AI_PROVIDER/AQENRA_OPENAI_API_KEY)
// never reads a generic OPENAI_API_KEY fallback, and exists.
const OPENAI_CONFIG_FILE = `${PROVIDERS_DIR}/openai-config.ts`;
const openaiConfigContent = stripComments(readIfExists(OPENAI_CONFIG_FILE));
ok = report("openai-config.ts exists and reads AQENRA_OPENAI_API_KEY", /AQENRA_OPENAI_API_KEY/.test(openaiConfigContent), "") && ok;
ok = report('openai-config.ts never reads a generic "OPENAI_API_KEY" fallback', !/[^_A-Z]OPENAI_API_KEY\b/.test(openaiConfigContent), "") && ok;
ok = report("openai-config.ts never logs anything itself", grep("console\\.(log|error|warn|info|debug)\\(", OPENAI_CONFIG_FILE) === "", "") && ok;

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
//
// providers/openai.ts is excluded from this ONE check, deliberately and
// explained: `client.chat.completions.create(...)` is the OpenAI SDK's
// own vendor method name, coincidentally matching this Prisma-mutation
// pattern (a real false positive, reproduced and confirmed here — not
// silently worked around). Excluding it does not weaken this rule's own
// actual guarantee for that file: providers/openai.ts is separately, and
// more precisely, forbidden from importing Prisma at all (see
// NEW_FILES_NO_PRISMA below) — a file that cannot import Prisma cannot
// possibly call a real Prisma mutation method, so this substring check
// would only ever be a strictly weaker, redundant proxy for that file.
const mutationMethodPattern = "\\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\\(";
const mutationMethodUsage = grep(mutationMethodPattern, AI_DIR)
  .split("\n")
  .filter(Boolean)
  .filter((line) => line.split(":")[0] !== `${PROVIDERS_DIR}/openai.ts`)
  .join("\n");
ok = report("no mutation-capable Prisma method (create/update/delete/upsert/*Many) anywhere under src/lib/ai (providers/openai.ts excluded — see this rule's own comment)", mutationMethodUsage === "", mutationMethodUsage) && ok;

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

// 13. src/components/ai/ contains EXACTLY the two approved UI files —
// no more, no fewer, no substitutions. This rule's own prior wording
// ("no src/components/ai directory exists yet") is now factually wrong
// now that the staff AI Assistant drawer/UI batch deliberately adds one
// — a deliberate, explained rule change, the same discipline rule 8's
// own earlier Prisma-import-rule inversion and rule 14's own later
// route-directory update already established, not a silent drop.
const APPROVED_COMPONENTS_AI_FILES = ["ai-assistant-panel.tsx", "ai-assistant-trigger.tsx"];
const actualComponentsAiFiles = existsSync("src/components/ai") ? readdirSync("src/components/ai").sort() : [];
ok = report(
  "src/components/ai/ contains exactly the two approved UI files, no more/fewer/substitutions",
  JSON.stringify(actualComponentsAiFiles) === JSON.stringify([...APPROVED_COMPONENTS_AI_FILES].sort()),
  `found: ${actualComponentsAiFiles.join(", ")}`,
) && ok;

// 14. Exactly one route.ts exists anywhere under src/app/api/ai, at
// exactly the one approved path. Recursive walk (not a flat grep) since
// Next.js's own App Router file convention allows route.ts at any depth.
function findRouteFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...findRouteFiles(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}
const routeFilesUnderApiAi = findRouteFiles(API_AI_DIR);
ok = report(
  "exactly one route.ts exists under src/app/api/ai, at exactly the approved /api/ai/assistant path",
  routeFilesUnderApiAi.length === 1 && routeFilesUnderApiAi[0] === APPROVED_ROUTE_FILE,
  routeFilesUnderApiAi.join("\n"),
) && ok;

const routeContent = readIfExists(APPROVED_ROUTE_FILE);
const routeStripped = stripComments(routeContent);

// 15. POST only — no GET/PUT/PATCH/DELETE/HEAD/OPTIONS export anywhere in
// the route.
const exportsPost = /export\s+async\s+function\s+POST\s*\(/.test(routeStripped);
const exportsOtherVerbs = /export\s+(async\s+)?function\s+(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/.test(routeStripped);
ok = report(
  "the approved AI route exports POST only (no GET/PUT/PATCH/DELETE/HEAD/OPTIONS)",
  exportsPost && !exportsOtherVerbs,
  "",
) && ok;

// 16. The route calls the canonical auth boundary.
ok = report(
  "the approved AI route calls getAiAssistantRequestContext()",
  /getAiAssistantRequestContext\s*\(/.test(routeStripped),
  "",
) && ok;

// 17. organizationId reaching orchestration always comes from the auth
// context, never from the parsed request body — the request body's own
// variable names (validated/rawBody/body) must never be combined with
// ".organizationId" anywhere in the route.
const routeBodyOrgIdPattern = /(validated|rawBody|body)\.organizationId/;
ok = report(
  "the approved AI route's organizationId always comes from context.organizationId, never the request body",
  !routeBodyOrgIdPattern.test(routeStripped),
  "",
) && ok;

// 18. request-schema.ts's own allowed key set is exactly ["message"], and
// it never even mentions organizationId/userId/history/provider/
// mockScenario anywhere in its own source (comment-stripped) — a
// stronger guarantee than "not in the allowed-keys array," since it also
// catches a forbidden key sneaking in through a differently-named
// constant.
const requestSchemaContent = stripComments(readIfExists(REQUEST_SCHEMA_FILE));
const FORBIDDEN_REQUEST_SCHEMA_KEYS = ["organizationId", "userId", "history", "provider", "mockScenario"];
const forbiddenSchemaKeyHits = FORBIDDEN_REQUEST_SCHEMA_KEYS.filter((key) => new RegExp(`\\b${key}\\b`).test(requestSchemaContent));
ok = report(
  "request-schema.ts never mentions organizationId/userId/history/provider/mockScenario anywhere in its own source",
  forbiddenSchemaKeyHits.length === 0,
  forbiddenSchemaKeyHits.join(", "),
) && ok;
const allowedKeysMatch = requestSchemaContent.match(/ALLOWED_KEYS\s*=\s*\[([^\]]*)\]/);
ok = report(
  'request-schema.ts\'s own ALLOWED_KEYS is exactly ["message"]',
  !!allowedKeysMatch && allowedKeysMatch[1].replace(/\s/g, "") === '"message"',
  allowedKeysMatch ? allowedKeysMatch[1] : "not found",
) && ok;

// 19. Tool dispatch uses only the closed registry's own getAiToolByName()
// — never a bespoke lookup.
const orchestrateContent = stripComments(readIfExists(ORCHESTRATE_FILE));
ok = report(
  "orchestrate.ts dispatches tools only via the closed registry's getAiToolByName()",
  /getAiToolByName\s*\(/.test(orchestrateContent),
  "",
) && ok;

// 20. No dynamic import()/eval()/new Function() anywhere in the new
// orchestration/route files — tool dispatch and every other code path
// here must be fully static.
const dynamicExecPattern = "\\b(eval|new Function)\\(|\\bimport\\(";
const dynamicExecHits = [grep(dynamicExecPattern, AI_DIR), grep(dynamicExecPattern, API_AI_DIR)].filter(Boolean).join("\n");
ok = report(
  "no eval/new Function/dynamic import() anywhere under src/lib/ai or src/app/api/ai",
  dynamicExecHits === "",
  dynamicExecHits,
) && ok;

// 21. orchestration-limits.ts declares every required fixed numeric
// ceiling constant, and never reads process.env — nothing here is
// client/model-controlled.
const orchestrationLimitsContent = stripComments(readIfExists(ORCHESTRATION_LIMITS_FILE));
const REQUIRED_LIMIT_CONSTANTS = [
  "MAX_USER_MESSAGE_CHARS",
  "MAX_OUTPUT_TOKENS",
  "MAX_TOOL_CALLS_PER_TURN",
  "MAX_PROVIDER_CALLS_PER_TURN",
  "PROVIDER_CALL_TIMEOUT_MS",
  "ORCHESTRATION_DEADLINE_MS",
  "MAX_TOOL_RESULT_SERIALIZED_CHARS",
];
const missingLimitConstants = REQUIRED_LIMIT_CONSTANTS.filter(
  (name) => !new RegExp(`export const ${name}\\s*=\\s*[\\d_]`).test(orchestrationLimitsContent),
);
ok = report(
  "orchestration-limits.ts declares every required fixed numeric ceiling constant",
  missingLimitConstants.length === 0,
  missingLimitConstants.join(", "),
) && ok;
ok = report("orchestration-limits.ts never reads process.env", !/process\.env/.test(orchestrationLimitsContent), "") && ok;

// 22. orchestrate.ts's own loop-limit comparisons are fixed constants,
// never derived from request/model-controlled input.
const modelControlledLoopPattern = /(toolCallCount|providerCallCount)\s*[<>]=?\s*(validated|input|rawInput|call\.args|response\.)/;
ok = report(
  "orchestrate.ts's own tool/provider-call ceiling comparisons are never derived from request/model input",
  !modelControlledLoopPattern.test(orchestrateContent),
  "",
) && ok;

// 23. The same import-boundary/mutation/vendor-SDK/logging concerns every
// existing src/lib/ai-scoped rule above already enforces, re-applied to
// the one new file this batch adds OUTSIDE src/lib/ai (route.ts) — none
// of the AI_DIR-scoped greps above ever see it.
const vendorSdkInRoute = grep(vendorSdkPattern, API_AI_DIR);
ok = report("no vendor AI SDK import in the AI route", vendorSdkInRoute === "", vendorSdkInRoute) && ok;

const mutationMethodInRoute = grep(mutationMethodPattern, API_AI_DIR);
ok = report("no mutation-capable Prisma method anywhere under src/app/api/ai", mutationMethodInRoute === "", mutationMethodInRoute) && ok;

const useServerInRoute = grep('"use server"', API_AI_DIR);
const actionsImportInRoute = grep('from ".*actions"', API_AI_DIR, "-E");
ok = report('no "use server" directive in the AI route', useServerInRoute === "", useServerInRoute) && ok;
ok = report("no actions.ts import in the AI route", actionsImportInRoute === "", actionsImportInRoute) && ok;

const portalImportInRoute = grep('from "@/lib/current-portal-user"', API_AI_DIR);
ok = report("no Client Portal import in the AI route", portalImportInRoute === "", portalImportInRoute) && ok;

const platformAdminImportInRoute = grep('from "@/lib/platform-admin/', API_AI_DIR);
ok = report("no Platform Admin import anywhere under src/app/api/ai", platformAdminImportInRoute === "", platformAdminImportInRoute) && ok;

const consoleInRoute = grep("console\\.(log|error|warn|info|debug)\\(", API_AI_DIR);
ok = report("no console logging in the AI route", consoleInRoute === "", consoleInRoute) && ok;

const rawQueryInRoute = grep(rawQueryPattern, API_AI_DIR);
ok = report("no raw Prisma query capability in the AI route", rawQueryInRoute === "", rawQueryInRoute) && ok;

// 24. The one allowed logAiAssistantEvent() call site (inside
// orchestrate.ts) never references the user's message, the final answer,
// tool args, tool results, or the raw messages array — defense in depth
// alongside logging-policy.ts's own hardened runtime validator (which
// already throws on any unexpected key/shape at runtime; this is the
// static-source-level backstop).
const logCallBlocks = extractBalancedBlocks(orchestrateContent, "logAiAssistantEvent\\(\\{");
const forbiddenLogContentPattern = /\buserMessage\b|\banswer\b|\btoolArgs\b|\btoolResult\b|\bmessages\b/;
const hasForbiddenLogContent = logCallBlocks.some((block) => forbiddenLogContentPattern.test(block));
ok = report(
  "orchestrate.ts's own logAiAssistantEvent() call never references userMessage/answer/toolArgs/toolResult/messages",
  logCallBlocks.length > 0 && !hasForbiddenLogContent,
  "",
) && ok;

// 25. The approved AI route always sets Cache-Control: private, no-store.
//
// Hardening (found during the orchestration + Route Handler PR's own
// merge audit, closed here): this rule originally matched against
// routeContent (raw, unstripped) — a comment reading "This route always
// sets private, no-store on every response" could satisfy the regex
// even if the real NO_STORE_HEADERS constant were emptied out, the same
// comment-only false-positive class Finding B (request-context.ts's own
// isPlatformAdmin() check) already closed elsewhere in this file.
// routeStripped (comment-stripped once, above) is what every other
// route.ts-scoped rule in this file already uses — this one now matches
// that same discipline instead of being the one exception.
ok = report(
  "the approved AI route sets Cache-Control: private, no-store",
  /private,\s*no-store/.test(routeStripped),
  "",
) && ok;

// 26. No provider-vendor env var/config is read anywhere in the new
// orchestration/route/provider-factory files — there is no real provider
// branch in this batch at all.
const providerFactoryContent = stripComments(readIfExists(PROVIDER_FACTORY_FILE));
const unconfiguredProviderContent = stripComments(readIfExists(UNCONFIGURED_PROVIDER_FILE));
ok = report("orchestrate.ts never reads process.env", !/process\.env/.test(orchestrateContent), "") && ok;
ok = report("the approved AI route never reads process.env directly", !/process\.env/.test(routeStripped), "") && ok;
ok = report(
  "provider-factory.ts never reads process.env directly (uses the shared TEST_MODE constant only)",
  !/process\.env/.test(providerFactoryContent),
  "",
) && ok;
ok = report(
  "unconfigured-provider.ts makes no network call and reads no env var",
  !/fetch\(|http\.request|https\.request|process\.env/.test(unconfiguredProviderContent),
  "",
) && ok;

// 27. Production fail-closed, CRITICAL. Two properties, both required —
// a deliberate, explained rule change (not a silent drop) now that this
// batch adds a real, config-gated provider branch:
//   a) MockAiProvider is still only ever returned when the shared
//      TEST_MODE constant is true — unchanged from before this batch.
//   b) The real OpenAI branch is reachable ONLY through
//      getOpenAiProviderConfig() (openai-config.ts) — provider-factory.ts
//      itself never reads AI_PROVIDER/AQENRA_OPENAI_API_KEY, and never
//      constructs createOpenAiProvider with anything other than that
//      config's own validated apiKey. Every other outcome (TEST_MODE
//      false AND config not "configured") falls through to
//      createUnconfiguredAiProvider() — still the fail-closed default,
//      and still what today's Production (which sets neither env var)
//      actually resolves to.
const importsTestMode = /import\s*\{[^}]*\bTEST_MODE\b[^}]*\}\s*from\s*"@\/lib\/test-mode"/.test(providerFactoryContent);
const gatesMockOnTestMode = /if\s*\(\s*TEST_MODE\s*\)[\s\S]{0,120}MockAiProvider/.test(providerFactoryContent);
ok = report(
  "provider-factory.ts only ever returns MockAiProvider when the shared TEST_MODE constant is true",
  importsTestMode && gatesMockOnTestMode,
  "",
) && ok;

const importsOpenAiConfig = /import\s*\{[^}]*\bgetOpenAiProviderConfig\b[^}]*\}\s*from\s*"\.\/openai-config"/.test(providerFactoryContent);
const gatesRealProviderOnConfiguredStatus = /config\.status\s*===\s*"configured"[\s\S]{0,120}createOpenAiProvider\(\s*config\.apiKey\s*\)/.test(providerFactoryContent);
const providerFactoryReadsEnvDirectly = /process\.env/.test(providerFactoryContent);
ok = report(
  "provider-factory.ts's real OpenAI branch is reachable only via getOpenAiProviderConfig()'s own validated {status:\"configured\", apiKey}, and the file itself never reads process.env directly",
  importsOpenAiConfig && gatesRealProviderOnConfiguredStatus && !providerFactoryReadsEnvDirectly,
  "",
) && ok;

// 28. The route itself checks provider availability before doing
// anything else — isAiAssistantAvailable() is actually CALLED (not
// merely imported — an import-only match would find the import
// statement itself, which is always near the top of the file regardless
// of call order) before getAiAssistantRequestContext() is actually
// called.
const availabilityCallIndex = routeStripped.indexOf("isAiAssistantAvailable()");
const authCallIndex = routeStripped.indexOf("getAiAssistantRequestContext()");
ok = report(
  "the approved AI route checks provider availability (isAiAssistantAvailable) before calling auth",
  availabilityCallIndex !== -1 && authCallIndex !== -1 && availabilityCallIndex < authCallIndex,
  "",
) && ok;

// 29. No schema persistence: none of the new orchestration/route files
// import Prisma directly — nothing here writes or reads a conversation
// row (no such model exists, and none may be added in this batch).
const NEW_FILES_NO_PRISMA = [
  ORCHESTRATE_FILE,
  REQUEST_SCHEMA_FILE,
  ORCHESTRATION_LIMITS_FILE,
  SYSTEM_PROMPT_FILE,
  PROVIDER_FACTORY_FILE,
  UNCONFIGURED_PROVIDER_FILE,
  APPROVED_ROUTE_FILE,
  `${PROVIDERS_DIR}/openai.ts`,
  `${PROVIDERS_DIR}/openai-config.ts`,
];
const prismaImportHits = NEW_FILES_NO_PRISMA.filter(existsSync).filter((file) =>
  /from\s*"@\/lib\/prisma"|from\s*"@\/generated\/prisma/.test(stripComments(readIfExists(file))),
);
ok = report(
  "none of the new orchestration/route files import Prisma directly (no conversation persistence in this batch)",
  prismaImportHits.length === 0,
  prismaImportHits.join("\n"),
) && ok;

// 30. Rate limit: the new AI_ASSISTANT_LIMIT scope exists and is applied
// in the route before orchestration.
//
// Hardening (found during the orchestration + Route Handler PR's own
// merge audit, closed here): this rule originally matched against the
// raw, unstripped file content — a comment retaining the exact
// declaration text (e.g. the real line commented out and replaced with
// a broken one) could satisfy the regex even though the real
// AI_ASSISTANT_LIMIT no longer has the expected shape at all. Same
// comment-only false-positive class as rule 25 above; same fix —
// stripComments() first, matching every other declaration-shaped rule
// in this file (e.g. rule 21's own limit-constant check).
const rateLimitLimitsContent = stripComments(readIfExists("src/lib/rate-limit/limits.ts"));
ok = report(
  'src/lib/rate-limit/limits.ts declares AI_ASSISTANT_LIMIT with scope "ai-assistant"',
  /export const AI_ASSISTANT_LIMIT[\s\S]{0,120}scope:\s*"ai-assistant"/.test(rateLimitLimitsContent),
  "",
) && ok;
ok = report(
  "the approved AI route calls checkRateLimit(AI_ASSISTANT_LIMIT, ...)",
  /checkRateLimit\s*\(\s*AI_ASSISTANT_LIMIT/.test(routeStripped),
  "",
) && ok;

// --- Staff AI Assistant drawer/UI batch ---
//
// A new trust boundary this file has never had to check before: the
// first real, mounted UI surface for this feature. Every rule below
// follows the exact same "comment-stripped where matching a real
// import/declaration/call, never a raw grep alone" discipline the rest
// of this file already established (including the two rules 25/30
// themselves hardened into that discipline, closing the one prior
// regression this file's own history has already had) — deliberately
// written this way from the start, not discovered as a gap later.

// 31. The trigger component (the one thing that actually mounts the
// feature) is imported by exactly one file — header.tsx — never Portal,
// never Platform Admin, never a second, independent mount point.
const triggerImporters = grep('from\\s*"@/components/ai/ai-assistant-trigger"', "src/")
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split(":")[0]);
const uniqueTriggerImporters = [...new Set(triggerImporters)];
ok = report(
  "AiAssistantTrigger is imported by exactly one file (header.tsx) — the staff shell's own single mount point",
  uniqueTriggerImporters.length === 1 && uniqueTriggerImporters[0] === HEADER_FILE,
  uniqueTriggerImporters.join("\n"),
) && ok;

// 32/33. No AI UI import anywhere under Portal or Platform Admin —
// mirrors this file's own existing "no Client Portal import" / "no
// Platform Admin import" rules (rules 3/4, and rule 23's own route-level
// extension of them), now extended to the product surfaces those
// identities actually render.
const aiUiImportPattern = 'from\\s*"@/components/ai/|from\\s*"@/lib/ai/client"';
const aiUiImportsInPortal = existsSync(PORTAL_DIR) ? grep(aiUiImportPattern, PORTAL_DIR) : "";
const aiUiImportsInPlatformAdmin = existsSync(PLATFORM_ADMIN_DIR) ? grep(aiUiImportPattern, PLATFORM_ADMIN_DIR) : "";
ok = report("no AI Assistant UI import anywhere under src/app/portal", aiUiImportsInPortal === "", aiUiImportsInPortal) && ok;
ok = report("no AI Assistant UI import anywhere under src/app/(platform-admin)", aiUiImportsInPlatformAdmin === "", aiUiImportsInPlatformAdmin) && ok;

// 34. The client AI components (trigger + panel) never import anything
// server-only from src/lib/ai/ except client.ts's own wire contract —
// the same "no provider/orchestration/tools/request-context leakage"
// boundary rule 27 already enforces for provider-factory.ts's own
// TEST_MODE gate, now enforced for the UI layer that consumes it.
const triggerStripped = stripComments(readIfExists(TRIGGER_FILE));
const panelStripped = stripComments(readIfExists(PANEL_FILE));
function aiLibImportSpecifiers(strippedContent) {
  const matches = strippedContent.match(/from\s*"([^"]*@\/lib\/ai[^"]*)"/g) || [];
  return matches.map((m) => m.match(/"([^"]+)"/)[1]);
}
const uiAiLibImports = [...aiLibImportSpecifiers(triggerStripped), ...aiLibImportSpecifiers(panelStripped)];
const disallowedUiAiLibImports = uiAiLibImports.filter((specifier) => specifier !== "@/lib/ai/client");
ok = report(
  "ai-assistant-trigger.tsx/ai-assistant-panel.tsx import nothing from src/lib/ai/ except client.ts's own wire contract",
  disallowedUiAiLibImports.length === 0,
  disallowedUiAiLibImports.join("\n"),
) && ok;

// 35. No MockAiProvider reference anywhere under src/components/ — the
// UI must never know the mock provider exists as a concept (see
// client.ts's own doc comment).
const mockProviderInComponents = existsSync(COMPONENTS_AI_DIR) ? grep("MockAiProvider", COMPONENTS_AI_DIR) : "";
ok = report("no MockAiProvider reference anywhere under src/components/ai", mockProviderInComponents === "", mockProviderInComponents) && ok;

// 36. client.ts's own request body construction never includes
// organizationId/userId/history/provider/mockScenario — the same closed
// request-schema.ts contract (rule 18) mirrored at the one client call
// site that actually constructs the HTTP body.
const aiClientStripped = stripComments(readIfExists(AI_CLIENT_FILE));
const bodyConstructionMatch = aiClientStripped.match(/body:\s*JSON\.stringify\([^)]*\)/);
const FORBIDDEN_CLIENT_BODY_KEYS = ["organizationId", "userId", "history", "provider", "mockScenario"];
const forbiddenClientBodyHits = bodyConstructionMatch
  ? FORBIDDEN_CLIENT_BODY_KEYS.filter((key) => bodyConstructionMatch[0].includes(key))
  : ["(no body: JSON.stringify(...) construction found at all)"];
ok = report(
  "client.ts's own request body never includes organizationId/userId/history/provider/mockScenario",
  bodyConstructionMatch !== null && forbiddenClientBodyHits.length === 0,
  forbiddenClientBodyHits.join(", "),
) && ok;

// 37. The endpoint is the one fixed literal string, never a
// template/dynamic path.
ok = report(
  'client.ts posts to the exact fixed literal "/api/ai/assistant" (never a template/dynamic endpoint)',
  /const AI_ASSISTANT_ENDPOINT = "\/api\/ai\/assistant";/.test(aiClientStripped),
  "",
) && ok;

// 38. No browser storage anywhere in the new UI files — question/answer
// live only in component memory (see this batch's own "no persistence"
// requirement).
const storagePattern = "\\blocalStorage\\b|\\bsessionStorage\\b|\\bindexedDB\\b";
const storageInComponents = existsSync(COMPONENTS_AI_DIR) ? grep(storagePattern, COMPONENTS_AI_DIR) : "";
const storageInClient = grep(storagePattern, AI_CLIENT_FILE);
ok = report("no localStorage/sessionStorage/indexedDB anywhere under src/components/ai or client.ts", storageInComponents === "" && storageInClient === "", [storageInComponents, storageInClient].filter(Boolean).join("\n")) && ok;

// 39. No dangerouslySetInnerHTML anywhere in the new UI files — the
// answer is always plain JSX text interpolation (see this batch's own
// "no markdown/HTML rendering" requirement).
const dangerousHtmlInComponents = existsSync(COMPONENTS_AI_DIR) ? grep("dangerouslySetInnerHTML", COMPONENTS_AI_DIR) : "";
ok = report("no dangerouslySetInnerHTML anywhere under src/components/ai", dangerousHtmlInComponents === "", dangerousHtmlInComponents) && ok;

// 40. No Server Action / business mutation import anywhere in the new UI
// files — AI output is read/draft text only, never a Send/Apply/Save
// action (see this batch's own "no action semantics" requirement).
const actionsImportInComponents = existsSync(COMPONENTS_AI_DIR) ? grep('from ".*actions"', COMPONENTS_AI_DIR, "-E") : "";
const useServerInComponents = existsSync(COMPONENTS_AI_DIR) ? grep('"use server"', COMPONENTS_AI_DIR) : "";
ok = report("no actions.ts import anywhere under src/components/ai", actionsImportInComponents === "", actionsImportInComponents) && ok;
ok = report('no "use server" directive anywhere under src/components/ai', useServerInComponents === "", useServerInComponents) && ok;

// 41. No console logging of prompt/answer content anywhere in the new UI
// files — mirrors rule 12's own "metadata-only, never content" logging
// discipline, extended to the client layer (which should log nothing at
// all, not even metadata).
const consoleInComponents = existsSync(COMPONENTS_AI_DIR) ? grep("console\\.(log|error|warn|info|debug)\\(", COMPONENTS_AI_DIR) : "";
const consoleInClient = grep("console\\.(log|error|warn|info|debug)\\(", AI_CLIENT_FILE);
ok = report("no console logging anywhere under src/components/ai or client.ts", consoleInComponents === "" && consoleInClient === "", [consoleInComponents, consoleInClient].filter(Boolean).join("\n")) && ok;

// 42. No streaming primitive anywhere in the new UI files — the backend
// is non-streaming by design (provider.ts's own AiProvider.stream is
// unimplemented); the UI must never fake it either.
const streamingPattern = "\\bEventSource\\b|\\bWebSocket\\b|ReadableStream";
const streamingInComponents = existsSync(COMPONENTS_AI_DIR) ? grep(streamingPattern, COMPONENTS_AI_DIR) : "";
const streamingInClient = grep(streamingPattern, AI_CLIENT_FILE);
ok = report("no EventSource/WebSocket/ReadableStream anywhere under src/components/ai or client.ts", streamingInComponents === "" && streamingInClient === "", [streamingInComponents, streamingInClient].filter(Boolean).join("\n")) && ok;

// 43. No client-controlled mock/provider selector anywhere in the new UI
// files — availability is a server-resolved boolean only (see this
// batch's own "no client-controlled feature flag" requirement).
//
// Comment-stripped (not a raw grep): client.ts's own doc comment
// legitimately discusses "no mockScenario" in prose, explaining exactly
// why this rule exists — the same false-positive class rules 25/30 were
// hardened against, avoided here from the start rather than discovered
// as a regression later.
const mockSelectorPattern = /mockScenario|providerSelector/;
const mockSelectorHits = [
  ["ai-assistant-trigger.tsx", triggerStripped],
  ["ai-assistant-panel.tsx", panelStripped],
  ["client.ts", aiClientStripped],
].filter(([, content]) => mockSelectorPattern.test(content));
ok = report(
  "no mockScenario/provider-selector field anywhere under src/components/ai or client.ts (comment-stripped)",
  mockSelectorHits.length === 0,
  mockSelectorHits.map(([name]) => name).join(", "),
) && ok;

// 44. The composer mirrors the server's own MAX_USER_MESSAGE_CHARS as a
// UI convenience only (never authoritative — request-schema.ts remains
// the real enforcement, unchanged by this batch).
ok = report(
  "the composer declares maxLength={2000}, mirroring MAX_USER_MESSAGE_CHARS as a UI convenience only",
  /maxLength=\{MAX_MESSAGE_CHARS\}/.test(panelStripped) && /const MAX_MESSAGE_CHARS = 2000;/.test(panelStripped),
  "",
) && ok;

// 45. No real provider/vendor SDK import, and no env var read, anywhere
// in the new UI files — this batch ships no real provider, by design.
const vendorSdkInComponents = existsSync(COMPONENTS_AI_DIR) ? grep(vendorSdkPattern, COMPONENTS_AI_DIR) : "";
const vendorSdkInClient = grep(vendorSdkPattern, AI_CLIENT_FILE);
ok = report("no vendor AI SDK import anywhere under src/components/ai or client.ts", vendorSdkInComponents === "" && vendorSdkInClient === "", [vendorSdkInComponents, vendorSdkInClient].filter(Boolean).join("\n")) && ok;
ok = report("no process.env reference anywhere under src/components/ai or client.ts", !/process\.env/.test(triggerStripped) && !/process\.env/.test(panelStripped) && !/process\.env/.test(aiClientStripped), "") && ok;

// 46. The staff availability boundary itself: (dashboard)/layout.tsx
// genuinely calls the real isAiAssistantAvailable() and passes only a
// plain boolean to Header — never TEST_MODE, provider identity, or any
// other config/env detail (see provider-factory.ts's own doc comment on
// why this boolean is deliberately the only thing it ever returns).
const dashboardLayoutStripped = stripComments(readIfExists(DASHBOARD_LAYOUT_FILE));
const headerStripped = stripComments(readIfExists(HEADER_FILE));
const importsIsAiAssistantAvailable = /import\s*\{[^}]*\bisAiAssistantAvailable\b[^}]*\}\s*from\s*"@\/lib\/ai\/providers\/provider-factory"/.test(dashboardLayoutStripped);
const callsIsAiAssistantAvailable = /isAiAssistantAvailable\(\)/.test(dashboardLayoutStripped);
const passesBooleanToHeader = /aiAssistantAvailable=\{aiAssistantAvailable\}/.test(dashboardLayoutStripped);
ok = report(
  "(dashboard)/layout.tsx imports and calls the real isAiAssistantAvailable(), passing only the boolean to Header (comment-stripped)",
  importsIsAiAssistantAvailable && callsIsAiAssistantAvailable && passesBooleanToHeader,
  "",
) && ok;
ok = report(
  "header.tsx never itself calls isAiAssistantAvailable() or imports provider-factory.ts (receives the boolean as a prop only, comment-stripped)",
  !/isAiAssistantAvailable\(\)/.test(headerStripped) && !/from\s*"[^"]*provider-factory"/.test(headerStripped),
  "",
) && ok;

process.exit(ok ? 0 : 1);
