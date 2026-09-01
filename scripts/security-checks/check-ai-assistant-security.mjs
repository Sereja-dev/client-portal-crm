import { readFileSync, existsSync, readdirSync } from "node:fs";
import { grep, report } from "./lib.mjs";

// AI Assistant Batch 1A — this feature's own trust boundary, the same
// discipline check-search-security.mjs already established for Global
// Search: a narrow, explicit, closed set of checks over this batch's own
// files, never a broad grep that would also reject a legitimate doc
// comment mentioning a forbidden word in prose.

let ok = true;

const AI_DIR = "src/lib/ai";
const REQUEST_CONTEXT_FILE = `${AI_DIR}/request-context.ts`;
const PROVIDER_FILE = `${AI_DIR}/provider.ts`;
const TOOLS_DIR = `${AI_DIR}/tools`;
const TOOLS_TYPES_FILE = `${TOOLS_DIR}/types.ts`;
const REGISTRY_FILE = `${TOOLS_DIR}/registry.ts`;
const PRIVACY_POLICY_FILE = `${AI_DIR}/privacy-policy.ts`;
const LOGGING_POLICY_FILE = `${AI_DIR}/logging-policy.ts`;

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
const importsIsPlatformAdmin = /import\s*\{[^}]*\bisPlatformAdmin\b[^}]*\}\s*from\s*"@\/lib\/platform-admin\/authorization"/.test(
  requestContextContent,
);
const callsIsPlatformAdmin = /isPlatformAdmin\(/.test(requestContextContent);
ok = report("getAiAssistantRequestContext imports and calls the canonical isPlatformAdmin()", importsIsPlatformAdmin && callsIsPlatformAdmin, "") && ok;

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

// 8. No Prisma import anywhere under src/lib/ai/tools — this batch adds
// zero business-data tools, and none may reach Prisma at all yet.
const prismaImportsInTools = existsSync(TOOLS_DIR)
  ? grep('from "@/lib/prisma"', TOOLS_DIR) + grep('from "@/generated/prisma', TOOLS_DIR)
  : "";
ok = report("no Prisma import anywhere under src/lib/ai/tools", prismaImportsInTools === "", prismaImportsInTools) && ok;

// 9. The tool registry currently registers zero tools — Batch 1A adds the
// registration mechanism only, never a business tool. A future batch that
// adds real tools must update this specific assertion deliberately (not
// widen it silently) — it exists to keep this PR honestly scoped, not to
// block the feature from ever growing.
const registryContent = readIfExists(REGISTRY_FILE);
// Excludes the function's own declaration line ("function registerAiTool(")
// — only a genuine call site (e.g. "registerAiTool(someTool)") counts.
const registerCalls = (stripComments(registryContent).match(/(?<!function )registerAiTool\(/g) || []).length;
ok = report("src/lib/ai/tools/registry.ts registers zero tools in this batch", registerCalls === 0, `${registerCalls} registerAiTool(...) call(s) found`) && ok;

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
// denylist.
const FORBIDDEN_FIELD_NAMES = ["bankName", "accountHolder", "accountNumber", "swiftBic", "providerCustomerId", "providerSubscriptionId", "pdfStoragePath"];
const forbiddenFieldPattern = `\\b(${FORBIDDEN_FIELD_NAMES.join("|")})\\b`;
const forbiddenFieldHits = grep(forbiddenFieldPattern, AI_DIR)
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.startsWith(`${PRIVACY_POLICY_FILE}:`));
ok = report(
  "no forbidden secret-bearing field name referenced under src/lib/ai outside privacy-policy.ts's own denylist",
  forbiddenFieldHits.length === 0,
  forbiddenFieldHits.join("\n"),
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
