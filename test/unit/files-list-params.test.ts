import { describe, expect, it } from "vitest";
import { parseFilesListParams, FILE_ENTITY_TYPE_FILTER_OPTIONS } from "@/app/(dashboard)/files/query";

/** Documents Slice D — Global Files V1 list-param parsing. Mirrors contracts-list-params.test.ts's own shape exactly. */

describe("parseFilesListParams", () => {
  it("defaults to an empty search and no entity-type filter", () => {
    const params = parseFilesListParams({});
    expect(params.q).toBe("");
    expect(params.entityType).toBeUndefined();
  });

  it("parses a valid entity type", () => {
    expect(parseFilesListParams({ type: "CLIENT" }).entityType).toBe("CLIENT");
    expect(parseFilesListParams({ type: "PROJECT" }).entityType).toBe("PROJECT");
    expect(parseFilesListParams({ type: "INVOICE" }).entityType).toBe("INVOICE");
  });

  it("falls back to undefined (All types) for an invalid entity type — never CONTRACT, never an error", () => {
    expect(parseFilesListParams({ type: "CONTRACT" }).entityType).toBeUndefined();
    expect(parseFilesListParams({ type: "bogus" }).entityType).toBeUndefined();
  });

  it("passes through a search string", () => {
    expect(parseFilesListParams({ q: "report" }).q).toBe("report");
  });

  it("the allowed entity-type filter values are exactly CLIENT/PROJECT/INVOICE — never CONTRACT", () => {
    expect(FILE_ENTITY_TYPE_FILTER_OPTIONS).toEqual(["CLIENT", "PROJECT", "INVOICE"]);
  });
});
