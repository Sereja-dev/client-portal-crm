import { describe, expect, it } from "vitest";
import { executeSearchTasks, SEARCH_TASKS_INPUT_SCHEMA } from "@/lib/ai/tools/tasks";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("executeSearchTasks — input validation", () => {
  it("rejects an unknown key: organizationId", async () => {
    expect(await executeSearchTasks(ORG_ID, { organizationId: "foreign" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: limit", async () => {
    expect(await executeSearchTasks(ORG_ID, { limit: 1000 })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: where/select", async () => {
    expect(await executeSearchTasks(ORG_ID, { where: {} })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an oversized query", async () => {
    expect(await executeSearchTasks(ORG_ID, { query: "a".repeat(101) })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid status enum", async () => {
    expect(await executeSearchTasks(ORG_ID, { status: "NOPE" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid priority enum", async () => {
    expect(await executeSearchTasks(ORG_ID, { priority: "SUPER_URGENT" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid dueBefore date", async () => {
    expect(await executeSearchTasks(ORG_ID, { dueBefore: "not-a-date" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a non-object input", async () => {
    expect(await executeSearchTasks(ORG_ID, "tasks")).toEqual({ ok: false, error: "invalid_input" });
  });
  it("treats null/undefined as an empty, valid filter set (not rejected)", async () => {
    const withNull = await executeSearchTasks(ORG_ID, null);
    const withUndefined = await executeSearchTasks(ORG_ID, undefined);
    expect(withNull.ok === false ? withNull.error : null).not.toBe("invalid_input");
    expect(withUndefined.ok === false ? withUndefined.error : null).not.toBe("invalid_input");
  });
});

describe("searchTasks — schema declaration", () => {
  it("forbids additional properties and never declares description/assignee", () => {
    expect(SEARCH_TASKS_INPUT_SCHEMA.additionalProperties).toBe(false);
    const keys = Object.keys(SEARCH_TASKS_INPUT_SCHEMA.properties);
    expect(keys).toEqual(["query", "status", "priority", "dueBefore"]);
    expect(keys).not.toContain("description");
    expect(keys).not.toContain("assignee");
    expect(keys).not.toContain("assigneeEmail");
  });
});
