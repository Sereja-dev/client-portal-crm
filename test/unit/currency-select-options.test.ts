import { describe, expect, it } from "vitest";
import { buildOrderedCurrencyOptions, POPULAR_CURRENCY_CODES } from "@/lib/invoices/currency-select-options";
import { matchesSearchableOption } from "@/components/ui/searchable-select";

/**
 * Forms Improvement Slice A1 §20 — the one ordering/search helper this
 * slice introduces. Every case here works against plain string arrays,
 * never the real `Intl.supportedValuesOf("currency")` set — this module
 * is a pure reordering function and must behave identically regardless
 * of which canonical currency source a caller passes in (Invoice's own
 * narrower two-decimal set, or Company Settings' own broader set).
 */
describe("POPULAR_CURRENCY_CODES — the locked Product ordering", () => {
  it("is exactly USD, EUR, GBP, AED, CAD, AUD, in that order", () => {
    expect(POPULAR_CURRENCY_CODES).toEqual(["USD", "EUR", "GBP", "AED", "CAD", "AUD"]);
  });
});

describe("buildOrderedCurrencyOptions", () => {
  it("places the priority group first, in Product's exact order, when every priority currency is supported", () => {
    const supported = ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD", "AED", "ZAR"];
    const options = buildOrderedCurrencyOptions(supported);
    expect(options.slice(0, 6).map((o) => o.value)).toEqual(["USD", "EUR", "GBP", "AED", "CAD", "AUD"]);
  });

  it("omits a priority code safely when it isn't in the supported set — never fabricates an unsupported currency", () => {
    const supported = ["USD", "EUR", "JPY"]; // no GBP/AED/CAD/AUD
    const options = buildOrderedCurrencyOptions(supported);
    expect(options.map((o) => o.value)).toEqual(["USD", "EUR", "JPY"]);
  });

  it("never duplicates a priority entry in the remainder", () => {
    const supported = ["USD", "EUR", "GBP", "AED", "CAD", "AUD", "JPY"];
    const options = buildOrderedCurrencyOptions(supported);
    const values = options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["USD", "EUR", "GBP", "AED", "CAD", "AUD", "JPY"]);
  });

  it("keeps the remaining (non-priority) currencies in their existing incoming order — never re-sorts them", () => {
    // Deliberately NOT alphabetical input for the remainder, to prove this
    // function doesn't silently re-sort — it only moves the priority group
    // to the front and leaves everything else exactly where it was.
    const supported = ["ZAR", "USD", "JPY", "EUR", "CHF"];
    const options = buildOrderedCurrencyOptions(supported);
    expect(options.map((o) => o.value)).toEqual(["USD", "EUR", "ZAR", "JPY", "CHF"]);
  });

  it("a persisted, already-selected non-priority currency remains a valid, present option", () => {
    const supported = ["USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"];
    const options = buildOrderedCurrencyOptions(supported);
    expect(options.some((o) => o.value === "SGD")).toBe(true);
  });

  it("never drops, adds, or renames a currency — output set equals input set exactly", () => {
    const supported = ["USD", "EUR", "GBP", "JPY", "KWD", "BHD"];
    const options = buildOrderedCurrencyOptions(supported);
    expect(new Set(options.map((o) => o.value))).toEqual(new Set(supported));
    expect(options).toHaveLength(supported.length);
  });

  it("every option's label is the bare currency code, matching this app's existing convention", () => {
    const options = buildOrderedCurrencyOptions(["USD", "EUR"]);
    for (const option of options) {
      expect(option.label).toBe(option.value);
    }
  });

  it("an empty supported list produces an empty option list, never a thrown error", () => {
    expect(buildOrderedCurrencyOptions([])).toEqual([]);
  });

  it("is a pure function — the same input always produces the same output, and never mutates its argument", () => {
    const supported = ["EUR", "USD", "GBP"];
    const snapshot = [...supported];
    const first = buildOrderedCurrencyOptions(supported);
    const second = buildOrderedCurrencyOptions(supported);
    expect(first).toEqual(second);
    expect(supported).toEqual(snapshot);
  });
});

/**
 * Forms Improvement Slice A1 §9/§20 — the deterministic, client-side
 * search rule the shared SearchableSelect primitive uses, exercised here
 * directly against real currency options (built via
 * buildOrderedCurrencyOptions, never a hand-written fixture) so this one
 * module proves both halves of the slice brief together: the options a
 * currency search would actually filter over, and the matching rule
 * itself.
 */
describe("matchesSearchableOption — applied to real currency options", () => {
  const options = buildOrderedCurrencyOptions(["USD", "EUR", "GBP", "AED", "CAD", "AUD", "JPY"]);
  const usd = options.find((o) => o.value === "USD")!;
  const aed = options.find((o) => o.value === "AED")!;

  it("`usd` matches the USD option by code", () => {
    expect(matchesSearchableOption(usd, "usd")).toBe(true);
  });

  it("`aed` matches the AED option by code", () => {
    expect(matchesSearchableOption(aed, "aed")).toBe(true);
  });

  it("is case-insensitive in both directions (query case and option case)", () => {
    expect(matchesSearchableOption(usd, "USD")).toBe(true);
    expect(matchesSearchableOption(usd, "Usd")).toBe(true);
    expect(matchesSearchableOption({ value: "usd", label: "usd" }, "USD")).toBe(true);
  });

  it("matches against the label the same way it matches against the code — today they're identical strings, so a query matching one always matches the other", () => {
    for (const option of options) {
      expect(matchesSearchableOption(option, option.label.toLowerCase())).toBe(true);
    }
  });

  it("a query that matches nothing returns false", () => {
    expect(matchesSearchableOption(usd, "zzz-not-a-currency")).toBe(false);
  });

  it("a blank/whitespace-only query matches every option", () => {
    for (const option of options) {
      expect(matchesSearchableOption(option, "")).toBe(true);
      expect(matchesSearchableOption(option, "   ")).toBe(true);
    }
  });

  it("a partial-code query matches only options containing that substring", () => {
    const matches = options.filter((o) => matchesSearchableOption(o, "d"));
    // USD, AED, CAD, AUD all contain "D" (case-insensitively) — GBP/JPY/EUR do not.
    expect(matches.map((o) => o.value).sort()).toEqual(["AED", "AUD", "CAD", "USD"]);
  });
});
