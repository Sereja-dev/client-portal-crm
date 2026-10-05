import { describe, expect, it } from "vitest";
import { parseAcceptedDocumentsListParams } from "@/app/(dashboard)/documents/accepted/query";

/** Documents Slice D — Accepted documents list-param parsing. Mirrors contracts-list-params.test.ts's own "archived" boolean convention exactly. */

describe("parseAcceptedDocumentsListParams", () => {
  it("defaults to archived: false", () => {
    expect(parseAcceptedDocumentsListParams({}).archived).toBe(false);
  });

  it("archived=1 parses to true", () => {
    expect(parseAcceptedDocumentsListParams({ archived: "1" }).archived).toBe(true);
  });

  it("any other value parses to false", () => {
    expect(parseAcceptedDocumentsListParams({ archived: "true" }).archived).toBe(false);
    expect(parseAcceptedDocumentsListParams({ archived: "0" }).archived).toBe(false);
  });
});
