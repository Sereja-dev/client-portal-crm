import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Validates the ALREADY-COMMITTED snapshot file's own shape — this test
 * suite deliberately never re-runs extract-fixtures.ts itself (that
 * needs the main app's Prisma/tsconfig context, which this isolated
 * package's own test run must never depend on — see
 * extract-fixtures.ts's own header comment and test/source-isolation.test.ts).
 */

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tool-contracts.snapshot.json");

describe("fixtures/tool-contracts.snapshot.json — committed snapshot shape", () => {
  const raw = readFileSync(SNAPSHOT_PATH, "utf8");
  const snapshot = JSON.parse(raw) as { tools: { name: string; description: string; inputSchema: unknown }[] };

  test("contains exactly six tool contracts", () => {
    assert.equal(snapshot.tools.length, 6);
  });

  test("contains exactly the approved six tool names, alphabetically sorted (deterministic serialization)", () => {
    const names = snapshot.tools.map((t) => t.name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b)),
    );
    assert.deepEqual(names.sort(), ["getClientDetail", "getOrganizationSummary", "searchClients", "searchInvoices", "searchProjects", "searchTasks"].sort());
  });

  test("every contract has exactly name/description/inputSchema — never an execute function, never database metadata, never an organizationId, never fixture data, never a secret-shaped field", () => {
    for (const tool of snapshot.tools) {
      assert.deepEqual(Object.keys(tool).sort(), ["description", "inputSchema", "name"]);
    }
    // Checked against the tools array's own serialization only — the
    // top-level $schemaNote field legitimately DISCUSSES these same
    // words in prose ("no execute implementation, no ... organizationId
    // ..."), the same doc-comment-vs-real-content distinction the app's
    // own security-check scripts are careful about (see
    // scripts/security-checks/check-ai-assistant-security.mjs's own
    // stripComments()) — this check must look at the actual tool
    // contract data, not this snapshot's own explanatory metadata.
    const toolsOnly = JSON.stringify(snapshot.tools);
    assert.equal(toolsOnly.includes("execute"), false);
    assert.equal(/organizationId/i.test(toolsOnly), false);
    assert.equal(/api[_-]?key/i.test(toolsOnly), false);
    assert.equal(/prisma/i.test(toolsOnly), false);
  });

  test("re-serializing the parsed snapshot with sorted keys byte-matches the file on disk (proves the committed file is itself deterministically sorted)", () => {
    function sortKeysDeep(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(sortKeysDeep);
      if (value !== null && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return sorted;
      }
      return value;
    }
    const parsed = JSON.parse(raw) as unknown;
    const reSorted = JSON.stringify(sortKeysDeep(parsed), null, 2) + "\n";
    assert.equal(reSorted, raw);
  });
});
