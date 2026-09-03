/**
 * Isolated Aqenra AI provider benchmark harness — tool-contract snapshot
 * extractor.
 *
 * THIS IS THE ONLY FILE ANYWHERE UNDER scripts/ai-provider-eval/ THAT IS
 * ALLOWED TO IMPORT THE REAL APP TOOL REGISTRY (and, transitively, Prisma
 * and other app query layers). It exists solely to read the six tools'
 * own static `name`/`description`/`inputSchema` values and serialize them
 * to a checked-in JSON snapshot — nothing else in this package ever
 * imports `@/lib/ai/tools/registry` or any of the five real tool
 * implementation files (organization-summary.ts, clients.ts, projects.ts,
 * tasks.ts, invoices.ts) again after this. See tool-runtime.ts's own
 * header comment for the isolated, fixture-backed executors that consume
 * this snapshot's OUTPUT instead of ever importing these modules live.
 *
 * MUST be run from the REPOSITORY ROOT, not from inside
 * scripts/ai-provider-eval/ — it needs the main app's own tsconfig `@/*`
 * path alias and its `node_modules` (Prisma client included) to resolve:
 *
 *   npx tsx scripts/ai-provider-eval/extract-fixtures.ts
 *
 * It is intentionally excluded from this package's own tsconfig.json
 * (see that file's own `exclude`) and instead gets its own dedicated,
 * root-context tsconfig for manual type-checking:
 *
 *   npx tsc -p scripts/ai-provider-eval/tsconfig.extract.json --noEmit
 *
 * This script NEVER:
 *  - calls any tool's execute() function
 *  - queries Prisma (no `prisma.*` call appears anywhere below — only a
 *    transitive, unexecuted import chain reaches it, the same way
 *    importing `@/lib/ai/tools/registry` unavoidably does)
 *  - authenticates, reads a session, or reads request-context.ts
 *  - calls Supabase
 *  - makes any HTTP request (to Aqenra, Anthropic, OpenAI, or anywhere
 *    else)
 * See test/source-isolation.test.ts for the mechanical proof of the
 * runtime-file half of this boundary, and this file's own doc comment
 * above for why it, alone, is the documented exception.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRegisteredAiTools } from "../../src/lib/ai/tools/registry";

const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-contracts.snapshot.json");

const EXPECTED_TOOL_NAMES = [
  "getClientDetail",
  "getOrganizationSummary",
  "searchClients",
  "searchInvoices",
  "searchProjects",
  "searchTasks",
] as const;

/** Recursively sorts every plain object's own keys so the serialized JSON diffs stably across repeat extractions, regardless of property declaration order in the source files. Arrays are left in their original order (schema `required`/`enum` order is meaningful, not incidental). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function main(): void {
  const tools = getRegisteredAiTools();

  const contracts = tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      // Deliberately NOT included: tool.execute (a function — never
      // serializable as data anyway, and never referenced here even by
      // name) or anything else on AiToolDefinition beyond these three
      // fields.
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const actualNames = contracts.map((c) => c.name).sort();
  const expectedNames = [...EXPECTED_TOOL_NAMES].sort();
  if (actualNames.length !== expectedNames.length || actualNames.some((n, i) => n !== expectedNames[i])) {
    console.error("extract-fixtures.ts: registered tool set does not match the expected closed six-tool list.");
    console.error(`  expected: ${expectedNames.join(", ")}`);
    console.error(`  actual:   ${actualNames.join(", ")}`);
    console.error("This is a hard stop — the benchmark must never silently target a different tool surface than production's own registry.ts.");
    process.exit(1);
  }

  const snapshot = {
    $schemaNote:
      "Aqenra AI provider benchmark — tool-contract snapshot. Extracted from src/lib/ai/tools/registry.ts's own getRegisteredAiTools(). Contains ONLY name/description/inputSchema per tool — no execute implementation, no database metadata, no organizationId, no fixture data, no secrets. Regenerate with: npx tsx scripts/ai-provider-eval/extract-fixtures.ts (from the repo root).",
    extractedFromGitSha: process.env.AQENRA_EVAL_EXTRACT_GIT_SHA ?? "unrecorded — pass AQENRA_EVAL_EXTRACT_GIT_SHA=$(git rev-parse HEAD) to record it",
    tools: sortKeysDeep(contracts),
  };

  const json = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(OUTPUT_PATH, json, "utf8");
  console.log(`Wrote ${contracts.length} tool contracts to ${OUTPUT_PATH}`);
  for (const c of contracts) {
    console.log(`  - ${c.name}`);
  }
}

main();
