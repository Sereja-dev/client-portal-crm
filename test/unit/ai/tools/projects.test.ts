import { describe, expect, it } from "vitest";
import { executeSearchProjects, SEARCH_PROJECTS_INPUT_SCHEMA } from "@/lib/ai/tools/projects";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("executeSearchProjects — input validation", () => {
  it("rejects an unknown key: organizationId", async () => {
    expect(await executeSearchProjects(ORG_ID, { organizationId: "foreign" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: limit", async () => {
    expect(await executeSearchProjects(ORG_ID, { limit: 999 })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: where/select", async () => {
    expect(await executeSearchProjects(ORG_ID, { where: {} })).toEqual({ ok: false, error: "invalid_input" });
    expect(await executeSearchProjects(ORG_ID, { select: {} })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an oversized query", async () => {
    expect(await executeSearchProjects(ORG_ID, { query: "a".repeat(101) })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid status enum", async () => {
    expect(await executeSearchProjects(ORG_ID, { status: "NOT_A_STATUS" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a malformed clientRef", async () => {
    expect(await executeSearchProjects(ORG_ID, { clientRef: "not-a-uuid" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a non-object input", async () => {
    expect(await executeSearchProjects(ORG_ID, 42)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("searchProjects — schema declaration", () => {
  it("forbids additional properties and never declares description/budget/ownerId", () => {
    expect(SEARCH_PROJECTS_INPUT_SCHEMA.additionalProperties).toBe(false);
    const keys = Object.keys(SEARCH_PROJECTS_INPUT_SCHEMA.properties);
    expect(keys).toEqual(["query", "status", "clientRef"]);
    expect(keys).not.toContain("description");
    expect(keys).not.toContain("budget");
    expect(keys).not.toContain("ownerId");
  });
});
