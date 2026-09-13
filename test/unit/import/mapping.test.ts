import { describe, expect, it } from "vitest";
import { validateImportMapping, suggestImportMapping, normalizeHeaderName } from "@/lib/import/mapping";
import { CLIENT_IMPORT_FIELDS, LEAD_IMPORT_FIELDS } from "@/lib/import/fields";

/**
 * CSV Import Phase 2 — column mapping validation and auto-suggestion.
 * The whole "mapping cannot target system/internal fields" security
 * property is structural here: CLIENT_IMPORT_FIELDS/LEAD_IMPORT_FIELDS
 * never include Tags/Custom Fields/Status/Stage/assignee/id/timestamp —
 * these tests confirm the fixed field lists themselves, plus every
 * mapping-shape invariant (one column -> one field, one field -> one
 * column, required field present).
 */
describe("validateImportMapping", () => {
  it("accepts a valid, complete mapping", () => {
    const result = validateImportMapping(
      [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }],
      CLIENT_IMPORT_FIELDS,
      2,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a mapping missing the required Name field", () => {
    const result = validateImportMapping([{ columnIndex: 0, field: "email" }], CLIENT_IMPORT_FIELDS, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_required_field");
    expect(result.error).toMatchObject({ field: "name" });
  });

  it("rejects two columns both mapped to the same field (duplicate target)", () => {
    const result = validateImportMapping(
      [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "name" }],
      CLIENT_IMPORT_FIELDS,
      2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("duplicate_target");
  });

  it("rejects the same column mapped to two fields (duplicate column)", () => {
    const result = validateImportMapping(
      [{ columnIndex: 0, field: "name" }, { columnIndex: 0, field: "email" }],
      CLIENT_IMPORT_FIELDS,
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("duplicate_column");
  });

  it("allows unmapped columns — the mapping simply omits them", () => {
    // 3 real CSV columns, only column 0 mapped to Name (required) — the
    // other two are implicitly "ignored," never an error.
    const result = validateImportMapping([{ columnIndex: 0, field: "name" }], CLIENT_IMPORT_FIELDS, 3);
    expect(result.ok).toBe(true);
  });

  it("rejects a column index outside the file's own actual header range", () => {
    const result = validateImportMapping([{ columnIndex: 0, field: "name" }, { columnIndex: 5, field: "email" }], CLIENT_IMPORT_FIELDS, 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("column_out_of_range");
  });

  it("rejects a mapping target that isn't a real field for this entity (deferred/system field)", () => {
    const result = validateImportMapping(
      [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "statusDefinitionId" }],
      CLIENT_IMPORT_FIELDS,
      2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown_field");
  });

  it.each(["tags", "customFields", "status", "stage", "assignedToUserId", "id", "organizationId", "createdAt", "updatedAt"])(
    "rejects %s as a mapping target for Client (never a real field in the fixed list)",
    (deferredField) => {
      const result = validateImportMapping([{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: deferredField }], CLIENT_IMPORT_FIELDS, 2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("unknown_field");
    },
  );

  it.each(["tags", "customFields", "stage", "assignedToUserId", "archivedAt", "lostReason", "convertedClientId", "convertedAt", "id"])(
    "rejects %s as a mapping target for Lead (never a real field in the fixed list)",
    (deferredField) => {
      const result = validateImportMapping([{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: deferredField }], LEAD_IMPORT_FIELDS, 2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("unknown_field");
    },
  );
});

describe("normalizeHeaderName", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    expect(normalizeHeaderName("Full Name")).toBe("fullname");
    expect(normalizeHeaderName("full_name")).toBe("fullname");
    expect(normalizeHeaderName("FULL-NAME")).toBe("fullname");
    expect(normalizeHeaderName("Email Address")).toBe("emailaddress");
  });
});

describe("suggestImportMapping — safe automatic suggestions", () => {
  it("suggests obvious 1:1 header matches", () => {
    const suggestions = suggestImportMapping(["Name", "Company", "Email"], CLIENT_IMPORT_FIELDS);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "company" },
        { columnIndex: 2, field: "email" },
      ]),
    );
  });

  it("suggests via a known alias header name", () => {
    const suggestions = suggestImportMapping(["Full Name", "Email Address"], CLIENT_IMPORT_FIELDS);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "email" },
      ]),
    );
  });

  it("leaves an unrecognized header unmapped rather than guessing", () => {
    const suggestions = suggestImportMapping(["Favorite Color"], CLIENT_IMPORT_FIELDS);
    expect(suggestions).toEqual([]);
  });

  it("never suggests the same field twice for two different headers, even if both would otherwise match", () => {
    const suggestions = suggestImportMapping(["Name", "Name"], CLIENT_IMPORT_FIELDS);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({ columnIndex: 0, field: "name" });
  });

  it("every suggestion it produces independently passes validateImportMapping", () => {
    const headers = ["Full Name", "Company", "Email Address", "Phone", "Notes"];
    const suggestions = suggestImportMapping(headers, CLIENT_IMPORT_FIELDS);
    const result = validateImportMapping(suggestions, CLIENT_IMPORT_FIELDS, headers.length);
    expect(result.ok).toBe(true);
  });
});
