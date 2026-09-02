import { describe, expect, it } from "vitest";
import { executeGetOrganizationSummary, GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA } from "@/lib/ai/tools/organization-summary";

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
});
