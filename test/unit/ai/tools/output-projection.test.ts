import { describe, expect, it } from "vitest";
import { assertExactKeys, assertExactKeysList } from "@/lib/ai/tools/output-projection";

describe("assertExactKeys", () => {
  it("passes through a value whose keys exactly match the allowed set", () => {
    const value = { name: "Acme", status: "ACTIVE" };
    expect(assertExactKeys(value, ["name", "status"], "testTool")).toBe(value);
  });

  it("throws when the value has an extra, unapproved key (e.g. a forgotten spread)", () => {
    const withExtra = { name: "Acme", status: "ACTIVE", email: "leaked@example.com" } as Record<string, unknown>;
    expect(() => assertExactKeys(withExtra as never, ["name", "status"] as never, "testTool")).toThrow(/unexpected field "email"/i);
  });
});

describe("assertExactKeysList", () => {
  it("passes through a list whose every item matches the allowed set", () => {
    const values = [{ ref: "a", name: "Acme" }, { ref: "b", name: "Beta" }];
    expect(assertExactKeysList(values, ["ref", "name"], "testTool")).toBe(values);
  });

  it("throws when any single item in the list has an extra key", () => {
    const values = [{ ref: "a", name: "Acme" }, { ref: "b", name: "Beta", notes: "leaked" }] as Record<string, unknown>[];
    expect(() => assertExactKeysList(values as never, ["ref", "name"] as never, "testTool")).toThrow(/unexpected field "notes"/i);
  });

  it("passes for an empty list", () => {
    expect(assertExactKeysList([], ["ref"], "testTool")).toEqual([]);
  });
});
