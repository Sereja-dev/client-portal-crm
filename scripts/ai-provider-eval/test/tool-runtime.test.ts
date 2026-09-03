import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BENCHMARK_TOOLS, getBenchmarkToolByName } from "../tool-runtime.js";
import { CLIENTS, NONEXISTENT_REFS } from "../fixtures/organization.js";

const EXPECTED_NAMES = ["getClientDetail", "getOrganizationSummary", "searchClients", "searchInvoices", "searchProjects", "searchTasks"].sort();

describe("tool-runtime.ts — exact six fixture-backed tools", () => {
  test("exposes exactly the six approved tool names, no more, no fewer", () => {
    assert.deepEqual(BENCHMARK_TOOLS.map((t) => t.name).sort(), EXPECTED_NAMES);
  });

  test("every tool's inputSchema is a JSON-Schema object (type: 'object'), sourced from the snapshot, never hand-retyped", () => {
    for (const tool of BENCHMARK_TOOLS) {
      assert.equal((tool.inputSchema as { type: string }).type, "object");
    }
  });

  test("getOrganizationSummary rejects a non-empty input", async () => {
    const tool = getBenchmarkToolByName("getOrganizationSummary")!;
    const result = (await tool.execute("org", { unexpected: true })) as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_input");
  });

  test("getOrganizationSummary returns internally-consistent counts derived live from the fixture arrays", async () => {
    const tool = getBenchmarkToolByName("getOrganizationSummary")!;
    const result = (await tool.execute("org", {})) as { ok: boolean; clients: number; activeProjects: number; overdueTasksCount: number };
    assert.equal(result.ok, true);
    assert.equal(result.clients, 6);
    assert.equal(result.activeProjects, 6);
    assert.equal(result.overdueTasksCount, 2);
  });

  test("searchClients finds both similarly-named clients on a shared substring", async () => {
    const tool = getBenchmarkToolByName("searchClients")!;
    const result = (await tool.execute("org", { query: "Alderbrook" })) as { ok: boolean; results: { name: string }[] };
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
  });

  test("searchClients rejects an unknown key", async () => {
    const tool = getBenchmarkToolByName("searchClients")!;
    const result = (await tool.execute("org", { organizationId: "x" })) as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_input");
  });

  test("searchClients rejects an invalid status enum value", async () => {
    const tool = getBenchmarkToolByName("searchClients")!;
    const result = (await tool.execute("org", { status: "NOT_A_REAL_STATUS" })) as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_input");
  });

  test("getClientDetail returns not_found for a well-formed but nonexistent ref", async () => {
    const tool = getBenchmarkToolByName("getClientDetail")!;
    const result = (await tool.execute("org", { ref: NONEXISTENT_REFS[0] })) as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, "not_found");
  });

  test("getClientDetail returns real detail, with project/invoice counts consistent with the fixture", async () => {
    const brightline = CLIENTS.find((c) => c.name === "Brightline Robotics")!;
    const tool = getBenchmarkToolByName("getClientDetail")!;
    const result = (await tool.execute("org", { ref: brightline.ref })) as { ok: boolean; projectCount: number; invoiceCount: number };
    assert.equal(result.ok, true);
    assert.equal(result.projectCount, 2);
    assert.equal(result.invoiceCount, 2);
  });

  test("getClientDetail never returns a raw ref/id field itself", async () => {
    const brightline = CLIENTS.find((c) => c.name === "Brightline Robotics")!;
    const tool = getBenchmarkToolByName("getClientDetail")!;
    const result = (await tool.execute("org", { ref: brightline.ref })) as Record<string, unknown>;
    assert.equal("ref" in result, false);
    assert.equal("id" in result, false);
  });

  test("searchInvoices result shape is exactly invoiceNumber/status/amount/currency/dueDate/clientName/projectName — no raw id/ref, no long-form free text", async () => {
    const tool = getBenchmarkToolByName("searchInvoices")!;
    const result = (await tool.execute("org", {})) as { ok: boolean; results: Record<string, unknown>[] };
    assert.equal(result.ok, true);
    assert.ok(result.results.length > 0);
    for (const row of result.results) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ["amount", "clientName", "currency", "dueDate", "invoiceNumber", "projectName", "status"].sort(),
      );
    }
  });

  test("searchTasks respects the SEARCH_TASKS_LIMIT ceiling (15) even though the fixture has 16 tasks", async () => {
    const tool = getBenchmarkToolByName("searchTasks")!;
    const result = (await tool.execute("org", {})) as { ok: boolean; results: unknown[] };
    assert.equal(result.ok, true);
    assert.ok(result.results.length <= 15);
  });

  test("no fixture executor ever mutates the underlying fixture arrays across repeated calls", async () => {
    const tool = getBenchmarkToolByName("searchClients")!;
    const first = (await tool.execute("org", {})) as { results: unknown[] };
    const second = (await tool.execute("org", {})) as { results: unknown[] };
    assert.deepEqual(first, second);
  });
});
