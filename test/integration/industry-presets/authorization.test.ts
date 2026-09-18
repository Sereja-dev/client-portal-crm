import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IndustryPresetAccessError,
  assertCanApplyIndustryPreset,
  canApplyIndustryPreset,
  canViewIndustryPresets,
} from "@/lib/industry-presets/authorization";

/**
 * Industry Presets V1 authorization (locked spec §5), moved out of
 * test/unit by Roles / Permissions V1: canApplyIndustryPreset/
 * assertCanApplyIndustryPreset are now resolver-backed (INDUSTRY_PRESETS_APPLY),
 * which reads RolePermissionOverride, so apply-side coverage can no
 * longer be a pure/DB-free unit test. A fresh, never-seeded
 * organizationId is enough for every apply case: OWNER never queries the
 * database (resolver's own OWNER short-circuit), ADMIN/MEMBER with zero
 * override rows exercise the "no override -> default" path (locked spec
 * §6's own zero-override-reproduces-Production-behavior guarantee).
 * canViewIndustryPresets is untouched by this feature (still
 * unconditional, still sync) and stays covered exactly as before.
 */
describe("Industry Presets authorization (zero overrides -- catalog defaults)", () => {
  it("OWNER may apply", async () => {
    const organizationId = randomUUID();
    expect(await canApplyIndustryPreset(organizationId, "OWNER")).toBe(true);
    await expect(assertCanApplyIndustryPreset(organizationId, "OWNER")).resolves.not.toThrow();
  });

  it("ADMIN may apply", async () => {
    const organizationId = randomUUID();
    expect(await canApplyIndustryPreset(organizationId, "ADMIN")).toBe(true);
    await expect(assertCanApplyIndustryPreset(organizationId, "ADMIN")).resolves.not.toThrow();
  });

  it("MEMBER may not apply (INDUSTRY_PRESETS_APPLY catalog default)", async () => {
    const organizationId = randomUUID();
    expect(await canApplyIndustryPreset(organizationId, "MEMBER")).toBe(false);
    await expect(assertCanApplyIndustryPreset(organizationId, "MEMBER")).rejects.toThrow(IndustryPresetAccessError);
  });

  it("every Staff role may view/preview, including MEMBER -- untouched by this feature", () => {
    expect(canViewIndustryPresets("OWNER")).toBe(true);
    expect(canViewIndustryPresets("ADMIN")).toBe(true);
    expect(canViewIndustryPresets("MEMBER")).toBe(true);
  });
});
