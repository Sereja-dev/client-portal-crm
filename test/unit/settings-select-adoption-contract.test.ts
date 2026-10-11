import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 5 (Design Investigation finding F4): `company-profile-
 * form.tsx`'s Currency and Time zone controls were two raw `<select>`
 * elements that hand-copied the shared `Select` primitive's className but
 * omitted its invalid-state (red border) branch — a validation error on
 * either field showed no visual cue, unlike every `Input`-based field on
 * the same form. Time zone still adopts the shared `Select` component
 * exactly as this file originally proved.
 *
 * Forms Improvement Slice A1 — Currency has since moved one layer further,
 * from `Select` to the new shared `CurrencySelect` (itself built on
 * `SearchableSelect`, see src/components/ui/searchable-select.tsx), so it
 * can be searched rather than scrolled through a long native dropdown.
 * This is the mechanical retarget: every assertion that named `<Select`
 * for the Currency control now names `<CurrencySelect` instead; the
 * behavior-relevant prop contract (id/name, the `fieldDefault(...)`-keyed
 * default value, `aria-invalid`, `required`) and the Time zone control's
 * own unchanged `<Select>` assertions are preserved byte-for-byte.
 */

const SOURCE_PATH = "src/app/(dashboard)/settings/company/company-profile-form.tsx";

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf-8");
}

describe("company-profile-form.tsx — Currency adopts CurrencySelect, Time zone keeps the shared Select primitive", () => {
  it("imports Select (for Time zone) from the shared ui/select module", () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{\s*Select\s*\}\s*from\s*["']@\/components\/ui\/select["']/);
  });

  it("imports CurrencySelect (for Currency) from the shared invoices/currency-select module", () => {
    const source = readSource();
    expect(source).toMatch(
      /import\s*\{\s*CurrencySelect\s*\}\s*from\s*["']@\/components\/invoices\/currency-select["']/,
    );
  });

  it("no longer contains a raw <select element", () => {
    const source = readSource();
    expect(source).not.toMatch(/<select\b/);
  });

  it("renders exactly one <Select component (Time zone) and exactly one <CurrencySelect component (Currency)", () => {
    const source = readSource();
    expect((source.match(/<Select\b/g) ?? []).length).toBe(1);
    expect((source.match(/<CurrencySelect\b/g) ?? []).length).toBe(1);
  });

  it("the Currency control keeps its exact id/name/defaultValue/aria-invalid/required contract", () => {
    const source = readSource();
    const block = source.slice(source.indexOf("Currency"), source.indexOf("Time zone"));
    expect(block).toMatch(/<CurrencySelect/);
    expect(block).toMatch(/id="currency"/);
    expect(block).toMatch(/name="currency"/);
    // Company Profile Failed-Validation Form State Preservation --
    // defaultValue (and key, checked by a later assertion below) now
    // prefer the just-submitted value on a rejected save, falling back
    // to the persisted profile only when no failed submission exists.
    expect(block).toMatch(/defaultValue=\{fieldDefault\(state\.values\?\.currency, profile\.currency\)\}/);
    expect(block).toMatch(/aria-invalid=\{!!state\.fieldErrors\?\.currency\}/);
    expect(block).toMatch(/\brequired\b/);
    // CurrencySelect takes the canonical currency list as a prop, never as
    // inline mapped <option> children (that generation now lives inside
    // buildOrderedCurrencyOptions, one layer down) — see
    // currency-select-options.test.ts for its own dedicated coverage.
    expect(block).toMatch(/supportedCurrencies=\{currencies\}/);
  });

  it("the Time zone control keeps its exact id/name/defaultValue/aria-invalid/required contract", () => {
    const source = readSource();
    const block = source.slice(source.indexOf("Time zone"), source.indexOf("</fieldset>"));
    expect(block).toMatch(/<Select/);
    expect(block).toMatch(/id="timezone"/);
    expect(block).toMatch(/name="timezone"/);
    // Company Profile Failed-Validation Form State Preservation -- see
    // the Currency control's own identical comment above.
    expect(block).toMatch(/defaultValue=\{fieldDefault\(state\.values\?\.timezone, profile\.timezone\)\}/);
    expect(block).toMatch(/aria-invalid=\{!!state\.fieldErrors\?\.timezone\}/);
    expect(block).toMatch(/\brequired\b/);
    expect(block).toMatch(/timezones\.map/);
  });

  it("neither the <Select> (Time zone) nor the <CurrencySelect> (Currency) call site duplicates a hand-copied className", () => {
    const source = readSource();
    // The old raw <select> elements each carried their own long className
    // string; the shared Select/CurrencySelect primitives supply this now
    // (CurrencySelect doesn't even expose a className prop — see its own
    // module), so neither call site should carry one at all.
    const selectBlocks = source.match(/<Select[^>]*>/g) ?? [];
    expect(selectBlocks.length).toBe(1);
    const currencySelectBlocks = source.match(/<CurrencySelect[\s\S]*?\/>/g) ?? [];
    expect(currencySelectBlocks.length).toBe(1);
    for (const block of [...selectBlocks, ...currencySelectBlocks]) {
      expect(block).not.toMatch(/className=/);
    }
  });

  it("both FormField labels (Currency, Time zone) remain correctly associated via htmlFor", () => {
    const source = readSource();
    expect(source).toMatch(/<FormField label="Currency" htmlFor="currency"/);
    expect(source).toMatch(/<FormField label="Time zone" htmlFor="timezone"/);
  });
});
