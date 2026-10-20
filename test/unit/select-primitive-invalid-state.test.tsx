import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "@/components/ui/select";

/**
 * Product UI/UX PR 5 (Design Investigation finding F4): the shared
 * `Select` primitive already has a correct invalid-state (red border)
 * branch — this is the primitive the two raw `<select>` elements in
 * `company-profile-form.tsx` (Currency, Time zone) adopt in this PR
 * specifically because their own hand-copied className omitted this
 * branch. This is a genuine behavior-level render test (real render
 * pipeline, `react-dom/server`, no jsdom/testing-library — see
 * invoice-issue-controls-contract.test.ts's own established precedent),
 * not a source-contract read.
 */

describe("Select — real render, invalid-state visual contract", () => {
  // Design System Phase 2 — the raw border-red-400/focus:ring-red-500 and
  // border-gray-300/focus:ring-black classes are replaced with the
  // semantic --danger and --border-form-control/--accent tokens (via the
  // shared formControlClasses helper — see its own doc comment), so
  // Select renders correctly on Dark's own surface.
  //
  // Accessibility Improvement A3+A5 — the resting valid border moved
  // from --border-strong to the dedicated --border-form-control token
  // (WCAG 1.4.11 contrast correction), and focus moved from focus: to
  // focus-visible: with a wider ring (see form-control-classes.ts's own
  // header comment) — updated here to match, mechanically, with no
  // change to what this test is actually proving (danger vs. ordinary
  // branch selection stays correct).
  it("renders the danger border/focus classes when aria-invalid is true", () => {
    const html = renderToStaticMarkup(
      <Select aria-invalid={true} name="currency" id="currency">
        <option value="USD">USD</option>
      </Select>,
    );
    expect(html).toMatch(/\bborder-danger\b/);
    expect(html).toMatch(/\bfocus-visible:ring-danger\b/);
    expect(html).not.toMatch(/\bborder-border-form-control\b/);
    expect(html).not.toMatch(/\bborder-red-400\b/);
  });

  it("renders the ordinary border-form-control/accent focus classes when aria-invalid is false or absent", () => {
    const html = renderToStaticMarkup(
      <Select aria-invalid={false} name="currency" id="currency">
        <option value="USD">USD</option>
      </Select>,
    );
    expect(html).toMatch(/\bborder-border-form-control\b/);
    expect(html).toMatch(/\bfocus-visible:ring-accent\b/);
    expect(html).not.toMatch(/\bborder-danger\b/);
    expect(html).not.toMatch(/\bborder-gray-300\b/);
    expect(html).not.toMatch(/\bfocus:ring-black\b/);
  });

  it("forwards standard select attributes unchanged (id, name, defaultValue, required, disabled)", () => {
    const html = renderToStaticMarkup(
      <Select id="timezone" name="timezone" defaultValue="UTC" required disabled={false}>
        <option value="UTC">UTC</option>
      </Select>,
    );
    expect(html).toMatch(/id="timezone"/);
    expect(html).toMatch(/name="timezone"/);
    expect(html).toMatch(/required/);
    expect(html).toContain("<option");
  });

  it("is a real native <select> — no custom combobox wrapper, no extra focusable element", () => {
    const html = renderToStaticMarkup(
      <Select name="currency">
        <option value="USD">USD</option>
      </Select>,
    );
    expect(html).toMatch(/^<select\b/);
    expect(html).not.toMatch(/<button|<input|<div[^>]*role="combobox"/);
  });
});
