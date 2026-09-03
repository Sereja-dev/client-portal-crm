/**
 * Benchmark definition v1.1.0 — structural case-schema validation.
 * Covers assertExactlyThirtySixBalancedCases()'s own v1.1.0 additions
 * (expectedFactGroups structural checks) plus direct unit tests of
 * assertValidFactAssertion() against constructed bad inputs, since the
 * real BENCHMARK_CASES is always already valid and can't exercise the
 * throw paths on its own.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BENCHMARK_CASES, assertExactlyThirtySixBalancedCases, assertValidFactAssertion, phrase, numeric } from "../cases.js";

describe("cases.ts — assertExactlyThirtySixBalancedCases() (real case suite)", () => {
  test("passes against the real, current 36-case suite", () => {
    assert.doesNotThrow(() => assertExactlyThirtySixBalancedCases());
  });

  test("exactly 36 cases, 12 categories x 3", () => {
    assert.equal(BENCHMARK_CASES.length, 36);
    const perCategory = new Map<string, number>();
    for (const c of BENCHMARK_CASES) perCategory.set(c.category, (perCategory.get(c.category) ?? 0) + 1);
    assert.equal(perCategory.size, 12);
    for (const count of perCategory.values()) assert.equal(count, 3);
  });

  test("every case's expectedFactGroups is an array of non-empty groups", () => {
    for (const c of BENCHMARK_CASES) {
      assert.ok(Array.isArray(c.expectedFactGroups), `${c.id}: expectedFactGroups must be an array`);
      for (const group of c.expectedFactGroups) {
        assert.ok(Array.isArray(group) && group.length > 0, `${c.id}: every group must be a non-empty array`);
      }
    }
  });

  test("every phrase assertion value is non-empty; every numeric assertion value/tolerance is finite and tolerance >= 0", () => {
    for (const c of BENCHMARK_CASES) {
      for (const group of c.expectedFactGroups) {
        for (const assertion of group) {
          if (assertion.kind === "phrase") {
            assert.ok(assertion.value.trim().length > 0, `${c.id}: empty phrase value`);
          } else {
            assert.ok(Number.isFinite(assertion.value), `${c.id}: non-finite numeric value`);
            if (assertion.toleranceAbs !== undefined) {
              assert.ok(Number.isFinite(assertion.toleranceAbs) && assertion.toleranceAbs >= 0, `${c.id}: invalid toleranceAbs`);
            }
          }
        }
      }
    }
  });

  test("no case uses both a legacy field and the new field — expectedKeyFacts must not exist anywhere on any case object (clean migration, no dual scoring systems)", () => {
    for (const c of BENCHMARK_CASES) {
      assert.equal("expectedKeyFacts" in c, false, `${c.id}: must not carry a leftover expectedKeyFacts property`);
    }
  });
});

describe("cases.ts — assertValidFactAssertion() (constructed bad inputs — must actually throw)", () => {
  test("throws on an empty phrase value", () => {
    assert.throws(() => assertValidFactAssertion("test-case", 0, phrase("")));
  });

  test("throws on a whitespace-only phrase value", () => {
    assert.throws(() => assertValidFactAssertion("test-case", 0, phrase("   ")));
  });

  test("throws on a non-finite numeric value", () => {
    assert.throws(() => assertValidFactAssertion("test-case", 0, numeric(NaN)));
    assert.throws(() => assertValidFactAssertion("test-case", 0, numeric(Infinity)));
  });

  test("throws on a negative toleranceAbs", () => {
    assert.throws(() => assertValidFactAssertion("test-case", 0, numeric(100, -1)));
  });

  test("throws on a non-finite toleranceAbs", () => {
    assert.throws(() => assertValidFactAssertion("test-case", 0, numeric(100, NaN)));
  });

  test("throws on an unrecognized assertion kind", () => {
    // Deliberately bypasses the type system to prove the RUNTIME check
    // itself rejects malformed data, not just the compiler.
    const malformed = { kind: "regex", value: ".*" } as unknown as ReturnType<typeof phrase>;
    assert.throws(() => assertValidFactAssertion("test-case", 0, malformed));
  });

  test("does NOT throw on well-formed phrase/numeric assertions", () => {
    assert.doesNotThrow(() => assertValidFactAssertion("test-case", 0, phrase("Alderbrook Studio")));
    assert.doesNotThrow(() => assertValidFactAssertion("test-case", 0, numeric(24250.5)));
    assert.doesNotThrow(() => assertValidFactAssertion("test-case", 0, numeric(0, 0)));
  });
});
