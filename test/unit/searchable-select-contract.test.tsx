import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CurrencySelect } from "@/components/invoices/currency-select";

/**
 * Forms Improvement Slice A1 §21 — real render tests (`react-dom/server`,
 * no jsdom/testing-library — this repo's own established convention, see
 * select-primitive-invalid-state.test.tsx and invoice-form-radio-focus
 * .test.tsx's own identical precedent; `vitest.config.mts` runs the
 * `node` environment only, with no DOM test library installed).
 *
 * A single server-side render always starts CLOSED (`open` defaults to
 * `false`), so the listbox/option popup — and therefore typing-to-filter,
 * keyboard navigation, Enter/Escape, and popular-currency option
 * ordering within the open popup — can only be exercised by a real
 * browser, not a static render. Those are covered by this slice's own
 * Playwright E2E coverage instead (test/e2e/searchable-currency-select
 * .spec.ts). What IS fully provable from a static render, and is what
 * this file covers: the trigger's own attributes/accessible wiring, the
 * closed-state displayed value, the hidden-input form-submission
 * contract, and the disabled/invalid prop pass-through.
 */

describe("SearchableSelect — real render, trigger contract", () => {
  const options = [
    { value: "USD", label: "USD" },
    { value: "EUR", label: "EUR" },
  ];

  it("renders exactly one combobox-role text input, associated with the given id (for the form's own <label for=...>)", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" />,
    );
    expect(html).toMatch(/<input[^>]*id="currency"[^>]*role="combobox"/);
    const inputMatches = html.match(/<input\b/g) ?? [];
    // Exactly the trigger input — no `name` prop was passed, so no
    // hidden input should be rendered either.
    expect(inputMatches).toHaveLength(1);
  });

  it("the closed-state displayed value is the selected option's label, not its raw value identity (today they're equal, but the input genuinely renders `selected.label`)", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={[{ value: "EUR", label: "Euro-ish label" }]} value="EUR" />,
    );
    expect(html).toMatch(/value="Euro-ish label"/);
  });

  it("an unrecognized controlled value renders an empty display, never a thrown error or a fabricated label", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="ZZZ" />,
    );
    expect(html).toMatch(/<input[^>]*value=""/);
  });

  it("renders no listbox/options markup on a fresh (closed) render", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" />,
    );
    expect(html).not.toMatch(/role="listbox"/);
    expect(html).not.toMatch(/role="option"/);
  });

  it("when `name` is passed, renders exactly one hidden input carrying that name and the current value — the exact existing FormData contract", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" name="currency" options={options} value="EUR" />,
    );
    expect(html).toMatch(/<input type="hidden" name="currency" value="EUR"\/>/);
    // The visible trigger input itself must never also carry this name —
    // otherwise FormData would see two same-named "currency" controls.
    const visibleInputTag = html.match(/<input[^>]*role="combobox"[^>]*>/)?.[0] ?? "";
    expect(visibleInputTag).not.toMatch(/name="currency"/);
  });

  it("when `name` is omitted, no hidden input is rendered at all (Quote's own calling convention)", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" />,
    );
    expect(html).not.toMatch(/type="hidden"/);
  });

  it("uncontrolled mode (`defaultValue`, no `value`/`onChange`) seeds the displayed value from `defaultValue` — Company Settings' own calling convention", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" name="currency" options={options} defaultValue="EUR" />,
    );
    expect(html).toMatch(/<input[^>]*value="EUR"/);
    expect(html).toMatch(/<input type="hidden" name="currency" value="EUR"\/>/);
  });

  it("disabled renders a real disabled attribute on the trigger input", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" disabled />,
    );
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });

  it("aria-invalid=true is forwarded to the trigger input unchanged", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" aria-invalid={true} aria-describedby="currency-error" />,
    );
    expect(html).toMatch(/aria-invalid="true"/);
    expect(html).toMatch(/aria-describedby="currency-error"/);
  });

  it("required renders aria-required (a hidden input can never carry native HTML `required` validation, so this is the trigger's own accessible signal)", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect id="currency" options={options} value="USD" required />,
    );
    expect(html).toMatch(/aria-required="true"/);
  });
});

describe("CurrencySelect — real render, currency-layer wiring", () => {
  it("renders through SearchableSelect with the exact same id/name/value/hidden-input contract", () => {
    const html = renderToStaticMarkup(
      <CurrencySelect id="currency" name="currency" value="GBP" supportedCurrencies={["USD", "EUR", "GBP"]} required />,
    );
    expect(html).toMatch(/<input[^>]*id="currency"[^>]*role="combobox"/);
    expect(html).toMatch(/<input type="hidden" name="currency" value="GBP"\/>/);
  });

  it("an org's already-persisted, non-priority currency still renders correctly as the selected value", () => {
    const html = renderToStaticMarkup(
      <CurrencySelect id="currency" value="SGD" supportedCurrencies={["USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"]} />,
    );
    expect(html).toMatch(/<input[^>]*value="SGD"/);
  });

  it("uncontrolled mode (Company Settings' own defaultValue + key-remount convention) still renders the right seeded value", () => {
    const html = renderToStaticMarkup(
      <CurrencySelect id="currency" name="currency" defaultValue="JPY" supportedCurrencies={["USD", "EUR", "JPY"]} />,
    );
    expect(html).toMatch(/<input[^>]*value="JPY"/);
    expect(html).toMatch(/<input type="hidden" name="currency" value="JPY"\/>/);
  });
});
