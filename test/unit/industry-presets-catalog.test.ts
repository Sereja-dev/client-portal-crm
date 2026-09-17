import { describe, expect, it } from "vitest";
import {
  INDUSTRY_PRESET_CATALOG,
  INDUSTRY_PRESET_KEYS,
  getIndustryPreset,
  isIndustryPresetKey,
  listIndustryPresets,
  summarizeIndustryPreset,
} from "@/lib/industry-presets/catalog";
import { validateIndustryPresetCatalog } from "@/lib/industry-presets/validation";

/**
 * Industry Presets V1 — catalog validation (locked spec §16). Exercises
 * validateIndustryPresetCatalog() against the real, shipped catalog
 * (never a hand-built fixture) so a future edit to catalog.ts that
 * violates any locked rule fails this test, not merely a runtime
 * surprise later.
 */

describe("Industry Presets catalog — validateIndustryPresetCatalog()", () => {
  it("the real catalog has zero violations", () => {
    expect(validateIndustryPresetCatalog()).toEqual([]);
  });

  it("contains exactly the four locked preset keys", () => {
    expect(INDUSTRY_PRESET_KEYS).toEqual(["freelancer", "creative_agency", "marketing_agency", "general_services"]);
    expect(Object.keys(INDUSTRY_PRESET_CATALOG).sort()).toEqual(
      ["creative_agency", "freelancer", "general_services", "marketing_agency"].sort(),
    );
  });

  it("every preset version is a positive integer", () => {
    for (const preset of listIndustryPresets()) {
      expect(Number.isInteger(preset.version)).toBe(true);
      expect(preset.version).toBeGreaterThan(0);
    }
  });

  it("status keys are unique within the same preset+entityType", () => {
    for (const preset of listIndustryPresets()) {
      const seen = new Set<string>();
      for (const status of preset.statuses) {
        const compound = `${status.entityType}:${status.key}`;
        expect(seen.has(compound)).toBe(false);
        seen.add(compound);
      }
    }
  });

  it("custom-field keys are unique within the same preset+entityType", () => {
    for (const preset of listIndustryPresets()) {
      const seen = new Set<string>();
      for (const field of preset.fields) {
        const compound = `${field.entityType}:${field.key}`;
        expect(seen.has(compound)).toBe(false);
        seen.add(compound);
      }
    }
  });

  it("tag normalized names are unique within a preset", () => {
    for (const preset of listIndustryPresets()) {
      const seen = new Set<string>();
      for (const tag of preset.tags) {
        const normalized = tag.name.trim().toLowerCase();
        expect(seen.has(normalized)).toBe(false);
        seen.add(normalized);
      }
    }
  });

  it("every SELECT field has non-empty, unique-label, unique-value options", () => {
    for (const preset of listIndustryPresets()) {
      for (const field of preset.fields) {
        if (field.fieldType !== "SELECT") continue;
        expect(field.options && field.options.length).toBeGreaterThan(0);
        const labels = new Set((field.options ?? []).map((o) => o.label));
        const values = new Set((field.options ?? []).map((o) => o.value));
        expect(labels.size).toBe(field.options?.length);
        expect(values.size).toBe(field.options?.length);
      }
    }
  });

  it("non-SELECT fields carry no options", () => {
    for (const preset of listIndustryPresets()) {
      for (const field of preset.fields) {
        if (field.fieldType === "SELECT") continue;
        expect(field.options === undefined || field.options.length === 0).toBe(true);
      }
    }
  });

  it("every V1 custom field is required: false", () => {
    for (const preset of listIndustryPresets()) {
      for (const field of preset.fields) {
        expect(field.required).toBe(false);
      }
    }
  });

  it("only CLIENT/LEAD/PROJECT entity types appear anywhere in the catalog", () => {
    const allowed = new Set(["CLIENT", "LEAD", "PROJECT"]);
    for (const preset of listIndustryPresets()) {
      for (const status of preset.statuses) {
        expect(allowed.has(status.entityType)).toBe(true);
      }
      for (const field of preset.fields) {
        expect(allowed.has(field.entityType)).toBe(true);
      }
    }
  });

  it("excludes every out-of-V1-scope primitive at the type level (no quoteTemplate/workflowAutomation/companyProfile/paymentDetails/domain fields exist on any preset definition)", () => {
    for (const preset of listIndustryPresets()) {
      const keys = Object.keys(preset);
      expect(keys).toEqual(["key", "version", "displayName", "description", "statuses", "fields", "tags"]);
    }
  });
});

describe("getIndustryPreset / isIndustryPresetKey", () => {
  it("resolves each of the four real keys", () => {
    for (const key of INDUSTRY_PRESET_KEYS) {
      expect(getIndustryPreset(key)?.key).toBe(key);
      expect(isIndustryPresetKey(key)).toBe(true);
    }
  });

  it("returns null / false for an unknown key, never throws", () => {
    expect(getIndustryPreset("not_a_real_preset")).toBeNull();
    expect(getIndustryPreset(undefined)).toBeNull();
    expect(getIndustryPreset(123)).toBeNull();
    expect(isIndustryPresetKey("not_a_real_preset")).toBe(false);
  });
});

describe("summarizeIndustryPreset", () => {
  it("matches each preset's own real item counts", () => {
    const freelancer = getIndustryPreset("freelancer")!;
    expect(summarizeIndustryPreset(freelancer)).toEqual({ statusCount: 6, fieldCount: 6, tagCount: 4 });
  });
});
