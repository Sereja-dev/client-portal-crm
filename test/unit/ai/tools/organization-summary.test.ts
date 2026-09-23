import { describe, expect, it } from "vitest";
import { executeGetOrganizationSummary, GET_ORGANIZATION_SUMMARY_DESCRIPTION, GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA } from "@/lib/ai/tools/organization-summary";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("executeGetOrganizationSummary — input validation (no DB reached)", () => {
  it("accepts undefined input without a DB error surfacing as invalid_input", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, undefined);
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });

  it("accepts an empty object", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, {});
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });

  it("rejects any key at all — this tool takes zero arguments", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, { anything: "x" });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects an attempt to pass organizationId", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, { organizationId: "foreign-org-id" });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects a non-object input", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, "not an object");
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects an array input", async () => {
    const result = await executeGetOrganizationSummary(ORG_ID, []);
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA", () => {
  it("declares no properties (takes no arguments)", () => {
    expect(GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA.properties)).toHaveLength(0);
  });

  it("schema shape is otherwise unchanged by the overdue-salience description repair (type: object, exactly these two keys plus additionalProperties/description)", () => {
    expect(GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA.type).toBe("object");
    expect(Object.keys(GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA).sort()).toEqual(["additionalProperties", "description", "properties", "type"]);
  });
});

/**
 * Overdue-summary salience repair (R3) — see the read-only scoping audit
 * this implements. Proves only that the new description text exists
 * verbatim; this is a provider-visible tool-spec string, never a
 * model-behavior claim — whether a real provider actually selects this
 * tool more often can only be shown by a later live validation, not by
 * a test in this file (mirrors system-prompt.test.ts's own identical
 * "offline proof only" framing for the shared system prompt).
 */
describe("GET_ORGANIZATION_SUMMARY_DESCRIPTION — overdue-summary salience (R3)", () => {
  it("equals the selected overdue-salience wording exactly", () => {
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION).toBe(
      "Returns a summary of the current organization's business state, including overdue-task counts and an overview of which tasks are overdue: client/project/task/invoice counts and status breakdowns, recent invoices, and upcoming/overdue tasks. Takes no arguments.",
    );
  });

  it("still discloses that the tool takes no arguments (unchanged from before this repair)", () => {
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION).toContain("Takes no arguments.");
  });

  it("still names every pre-existing summary category (client/project/task/invoice counts and breakdowns, recent invoices, upcoming/overdue tasks) — nothing was removed by the overdue-salience insertion", () => {
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION).toContain("client/project/task/invoice counts and status breakdowns");
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION).toContain("recent invoices");
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION).toContain("upcoming/overdue tasks");
  });

  it("does not claim exclusivity or prohibit any other tool (no 'only'/'always'/'never use searchTasks'-style language)", () => {
    expect(GET_ORGANIZATION_SUMMARY_DESCRIPTION.toLowerCase()).not.toMatch(/\bonly\b|\balways\b|searchtasks/);
  });
});
