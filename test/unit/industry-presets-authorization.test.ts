import { describe, expect, it } from "vitest";
import {
  IndustryPresetAccessError,
  assertCanApplyIndustryPreset,
  canApplyIndustryPreset,
  canViewIndustryPresets,
} from "@/lib/industry-presets/authorization";

/** Industry Presets V1 — authorization (locked spec §5): OWNER/ADMIN apply, MEMBER views/previews but never applies. */
describe("Industry Presets authorization", () => {
  it("OWNER may apply", () => {
    expect(canApplyIndustryPreset("OWNER")).toBe(true);
    expect(() => assertCanApplyIndustryPreset("OWNER")).not.toThrow();
  });

  it("ADMIN may apply", () => {
    expect(canApplyIndustryPreset("ADMIN")).toBe(true);
    expect(() => assertCanApplyIndustryPreset("ADMIN")).not.toThrow();
  });

  it("MEMBER may not apply", () => {
    expect(canApplyIndustryPreset("MEMBER")).toBe(false);
    expect(() => assertCanApplyIndustryPreset("MEMBER")).toThrow(IndustryPresetAccessError);
  });

  it("every Staff role may view/preview, including MEMBER", () => {
    expect(canViewIndustryPresets("OWNER")).toBe(true);
    expect(canViewIndustryPresets("ADMIN")).toBe(true);
    expect(canViewIndustryPresets("MEMBER")).toBe(true);
  });
});
