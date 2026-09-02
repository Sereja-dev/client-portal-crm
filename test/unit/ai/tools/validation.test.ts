import { describe, expect, it } from "vitest";
import {
  AI_TOOL_QUERY_MAX_LENGTH,
  isPlainObject,
  hasOnlyAllowedKeys,
  isValidOptionalQuery,
  isValidEnum,
  isValidOptionalEnum,
  isValidRef,
  isValidOptionalRef,
  isValidOptionalIsoDate,
} from "@/lib/ai/tools/validation";

describe("isPlainObject", () => {
  it("accepts a plain object", () => expect(isPlainObject({})).toBe(true));
  it("rejects an array", () => expect(isPlainObject([])).toBe(false));
  it("rejects null", () => expect(isPlainObject(null)).toBe(false));
  it("rejects a string/number/undefined", () => {
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("hasOnlyAllowedKeys", () => {
  it("accepts an object whose keys are a subset of allowed", () => {
    expect(hasOnlyAllowedKeys({ query: "x" }, ["query", "status"])).toBe(true);
    expect(hasOnlyAllowedKeys({}, ["query"])).toBe(true);
  });
  it("rejects an unknown key: organizationId", () => {
    expect(hasOnlyAllowedKeys({ organizationId: "x" }, ["query"])).toBe(false);
  });
  it("rejects an unknown key: userId", () => {
    expect(hasOnlyAllowedKeys({ userId: "x" }, ["query"])).toBe(false);
  });
  it("rejects an unknown key: limit", () => {
    expect(hasOnlyAllowedKeys({ query: "x", limit: 1000 }, ["query"])).toBe(false);
  });
  it("rejects an unknown key: where", () => {
    expect(hasOnlyAllowedKeys({ where: { organizationId: "x" } }, ["query"])).toBe(false);
  });
  it("rejects an unknown key: select", () => {
    expect(hasOnlyAllowedKeys({ select: { email: true } }, ["query"])).toBe(false);
  });
});

describe("isValidOptionalQuery", () => {
  it("accepts undefined", () => expect(isValidOptionalQuery(undefined)).toBe(true));
  it("accepts a short string", () => expect(isValidOptionalQuery("acme")).toBe(true));
  it(`accepts exactly ${AI_TOOL_QUERY_MAX_LENGTH} chars`, () => {
    expect(isValidOptionalQuery("a".repeat(AI_TOOL_QUERY_MAX_LENGTH))).toBe(true);
  });
  it("rejects an oversized query", () => {
    expect(isValidOptionalQuery("a".repeat(AI_TOOL_QUERY_MAX_LENGTH + 1))).toBe(false);
  });
  it("rejects a non-string", () => {
    expect(isValidOptionalQuery(123)).toBe(false);
    expect(isValidOptionalQuery(null)).toBe(false);
    expect(isValidOptionalQuery({})).toBe(false);
  });
});

describe("isValidEnum / isValidOptionalEnum", () => {
  const STATUSES = ["LEAD", "ACTIVE"] as const;
  it("accepts a valid enum value", () => expect(isValidEnum("ACTIVE", STATUSES)).toBe(true));
  it("rejects an invalid enum value", () => expect(isValidEnum("BOGUS", STATUSES)).toBe(false));
  it("optional variant accepts undefined", () => expect(isValidOptionalEnum(undefined, STATUSES)).toBe(true));
  it("optional variant rejects an invalid value", () => expect(isValidOptionalEnum("BOGUS", STATUSES)).toBe(false));
});

describe("isValidRef / isValidOptionalRef", () => {
  const REAL_UUID = "11111111-1111-1111-1111-111111111111";
  it("accepts a well-formed UUID", () => expect(isValidRef(REAL_UUID)).toBe(true));
  it("accepts a well-formed UUID uppercase", () => expect(isValidRef(REAL_UUID.toUpperCase())).toBe(true));
  it("rejects a malformed ref", () => {
    expect(isValidRef("not-a-uuid")).toBe(false);
    expect(isValidRef("11111111")).toBe(false);
    expect(isValidRef(123)).toBe(false);
  });
  it("rejects a SQL-injection-shaped ref", () => expect(isValidRef("' OR 1=1 --")).toBe(false));
  it("optional variant accepts undefined", () => expect(isValidOptionalRef(undefined)).toBe(true));
});

describe("isValidOptionalIsoDate", () => {
  it("accepts undefined", () => expect(isValidOptionalIsoDate(undefined)).toBe(true));
  it("accepts a valid ISO date string", () => expect(isValidOptionalIsoDate("2026-01-01T00:00:00.000Z")).toBe(true));
  it("accepts a plain date string", () => expect(isValidOptionalIsoDate("2026-01-01")).toBe(true));
  it("rejects an invalid date string", () => expect(isValidOptionalIsoDate("not-a-date")).toBe(false));
  it("rejects a non-string", () => expect(isValidOptionalIsoDate(12345)).toBe(false));
});
