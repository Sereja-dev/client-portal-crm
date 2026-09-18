import { describe, expect, it } from "vitest";
import {
  PERMISSION_KEYS,
  PERMISSION_CATALOG,
  getDefaultPermission,
  getGroupedPermissionCatalog,
  getPermissionCatalogEntry,
  isPermissionKey,
} from "@/lib/permissions/catalog";

/** Roles / Permissions V1 — catalog invariants (locked spec §2/§7/§22). */

describe("PERMISSION_KEYS / PERMISSION_CATALOG", () => {
  it("has exactly the 9 locked catalog keys", () => {
    expect(PERMISSION_KEYS).toEqual([
      "ANALYTICS_VIEW",
      "REPORTS_VIEW",
      "DATA_IMPORT",
      "DATA_EXPORT",
      "RECURRING_INVOICES_MANAGE",
      "TAGS_MANAGE",
      "WORKFLOW_AUTOMATIONS_MANAGE",
      "QUOTE_TEMPLATES_MANAGE",
      "INDUSTRY_PRESETS_APPLY",
    ]);
  });

  it("PERMISSION_CATALOG has exactly one entry per key, in the same order", () => {
    expect(PERMISSION_CATALOG.map((e) => e.key)).toEqual([...PERMISSION_KEYS]);
  });

  it("every entry has a non-empty label, description, and a valid group", () => {
    const validGroups = new Set(["Insights", "Data", "Finance / Operations", "Settings"]);
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(validGroups.has(entry.group)).toBe(true);
    }
  });
});

describe("isPermissionKey", () => {
  it("accepts every real catalog key", () => {
    for (const key of PERMISSION_KEYS) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it("rejects an unknown string, never a prefix/substring match", () => {
    expect(isPermissionKey("ANALYTICS_VIEW_EXTRA")).toBe(false);
    expect(isPermissionKey("ANALYTICS")).toBe(false);
    expect(isPermissionKey("analytics_view")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isPermissionKey(null)).toBe(false);
    expect(isPermissionKey(undefined)).toBe(false);
    expect(isPermissionKey(123)).toBe(false);
    expect(isPermissionKey({})).toBe(false);
    expect(isPermissionKey(["ANALYTICS_VIEW"])).toBe(false);
  });
});

describe("getDefaultPermission", () => {
  it("OWNER defaults true for every one of the 9 keys", () => {
    for (const key of PERMISSION_KEYS) {
      expect(getDefaultPermission("OWNER", key)).toBe(true);
    }
  });

  it("ADMIN defaults true for every one of the 9 keys", () => {
    for (const key of PERMISSION_KEYS) {
      expect(getDefaultPermission("ADMIN", key)).toBe(true);
    }
  });

  it("MEMBER defaults false for every one of the 9 keys", () => {
    for (const key of PERMISSION_KEYS) {
      expect(getDefaultPermission("MEMBER", key)).toBe(false);
    }
  });
});

describe("getPermissionCatalogEntry", () => {
  it("returns the exact catalog entry for a real key", () => {
    const entry = getPermissionCatalogEntry("ANALYTICS_VIEW");
    expect(entry.key).toBe("ANALYTICS_VIEW");
    expect(entry.label).toBe("Analytics");
  });
});

describe("getGroupedPermissionCatalog", () => {
  it("groups in Insights, Data, Finance / Operations, Settings order, matching the locked spec's own listed order", () => {
    const groups = getGroupedPermissionCatalog();
    expect(groups.map((g) => g.group)).toEqual(["Insights", "Data", "Finance / Operations", "Settings"]);
  });

  it("every entry appears exactly once, across all groups combined", () => {
    const groups = getGroupedPermissionCatalog();
    const allKeys = groups.flatMap((g) => g.entries.map((e) => e.key));
    expect(allKeys.sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("Settings group contains exactly Tags, Workflow automations, Quote templates, Apply industry presets, in that order", () => {
    const groups = getGroupedPermissionCatalog();
    const settings = groups.find((g) => g.group === "Settings");
    expect(settings?.entries.map((e) => e.key)).toEqual([
      "TAGS_MANAGE",
      "WORKFLOW_AUTOMATIONS_MANAGE",
      "QUOTE_TEMPLATES_MANAGE",
      "INDUSTRY_PRESETS_APPLY",
    ]);
  });
});
