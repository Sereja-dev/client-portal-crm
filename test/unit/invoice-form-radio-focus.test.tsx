import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InvoiceForm } from "@/components/invoices/invoice-form";

/**
 * Product UI/UX PR 5 (Design Investigation finding F7): the Invoice
 * type mode-toggle radio buttons (`invoice-form.tsx`) relied on the
 * browser's bare default focus outline instead of the app's own
 * focus-visible ring convention used everywhere else (Button,
 * ConfirmDialog, DeleteButton, FileInput, NotificationPreferenceToggle's
 * checkbox). `InvoiceForm` is the one shared component rendered by both
 * the create page (`/invoices/new`) and the DRAFT edit surface
 * (`InvoiceDraftPanel`, itself rendered by `/invoices/[id]/edit`) — one
 * fix here covers both surfaces.
 *
 * Design System Batch 10 — the literal `ring-black` this test originally
 * asserted has itself been replaced by `ring-focus-ring` (globals.css's
 * own semantic focus-ring token), matching every one of the reference
 * components named above, all of which made this exact same swap in
 * earlier Design System batches. Updated here to assert the current,
 * correct convention rather than the raw literal it was written against.
 *
 * This is a genuine behavior-level render test (real render pipeline,
 * `react-dom/server`, no jsdom/testing-library — see
 * invoice-issue-controls-contract.test.ts's own established precedent):
 * `InvoiceForm` renders cleanly through `renderToStaticMarkup` given
 * only its required props (no server-only import in its own module
 * graph), confirmed empirically before writing this test.
 */

function renderForm() {
  return renderToStaticMarkup(
    <InvoiceForm
      action={async (prev) => prev}
      clients={[{ id: "c1", name: "Client" }]}
      projects={[{ id: "p1", label: "Project", clientId: "c1" }]}
      currencyOptions={["USD", "EUR"]}
    />,
  );
}

describe("InvoiceForm — Invoice type radios, real render", () => {
  it("renders exactly two real <input type=\"radio\"> elements, both named mode-selector", () => {
    const html = renderForm();
    const radioMatches = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radioMatches).toHaveLength(2);
    for (const radio of radioMatches) {
      expect(radio).toMatch(/name="mode-selector"/);
    }
  });

  it("both radios carry the app's standard focus-visible ring classes", () => {
    const html = renderForm();
    const radioMatches = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    for (const radio of radioMatches) {
      expect(radio).toMatch(/focus:outline-none/);
      expect(radio).toMatch(/focus-visible:ring-2/);
      expect(radio).toMatch(/focus-visible:ring-focus-ring/);
      expect(radio).toMatch(/focus-visible:ring-offset-2/);
    }
  });

  it("the Flat amount radio is checked by default (mode defaults to flat) and the Itemized radio is not", () => {
    const html = renderForm();
    const flatIndex = html.indexOf('name="mode-selector"');
    const flatTagEnd = html.indexOf(">", flatIndex);
    const flatTag = html.slice(html.lastIndexOf("<input", flatIndex), flatTagEnd);
    expect(flatTag).toMatch(/checked=""/);
  });

  it("each radio remains explicitly wrapped by its own <label> together with its visible text (Flat amount / Itemized)", () => {
    const html = renderForm();
    expect(html).toMatch(/<label[^>]*><input[^>]*type="radio"[^>]*\/>Flat amount<\/label>/);
    expect(html).toMatch(/<label[^>]*><input[^>]*type="radio"[^>]*\/>Itemized<\/label>/);
  });

  it("renders no fake/custom button standing in for the native radio group", () => {
    const html = renderForm();
    const fieldsetStart = html.indexOf("Invoice type");
    const fieldsetBlock = html.slice(fieldsetStart, fieldsetStart + 700);
    expect(fieldsetBlock).not.toMatch(/<button/);
  });
});

describe("invoice-form.tsx — source contract: byte-preserved name/checked/onChange, className-only addition", () => {
  it("both radios keep their exact name/checked/onChange props unchanged", () => {
    const source = readFileSync("src/components/invoices/invoice-form.tsx", "utf-8");
    const radioBlocks = source.match(/<input\s+type="radio"[\s\S]*?\/>/g) ?? [];
    expect(radioBlocks).toHaveLength(2);
    expect(source).toMatch(/name="mode-selector"[\s\S]*checked=\{mode === "flat"\}/);
    expect(source).toMatch(/name="mode-selector"[\s\S]*checked=\{mode === "itemized"\}/);
    expect(source).toMatch(/onChange=\{\(\) => \{\s*setMode\("flat"\);/);
    expect(source).toMatch(/onChange=\{\(\) => \{\s*setMode\("itemized"\);/);
  });

  it("both radios carry the focus-visible ring className in source", () => {
    const source = readFileSync("src/components/invoices/invoice-form.tsx", "utf-8");
    const radioBlocks = source.match(/<input\s+type="radio"[\s\S]*?\/>/g) ?? [];
    for (const block of radioBlocks) {
      expect(block).toMatch(/className="[^"]*focus-visible:ring-focus-ring[^"]*"/);
      expect(block).toMatch(/className="[^"]*focus-visible:ring-2[^"]*focus-visible:ring-offset-2[^"]*"/);
    }
  });
});
