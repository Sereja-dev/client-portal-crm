import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 1 — the reusable, app-authored, accessible file-picker
 * component (src/components/ui/file-input.tsx).
 *
 * No DOM/component-rendering harness exists in this repo (no
 * `@testing-library/react`/jsdom setup anywhere — see
 * invoice-issue-controls-contract.test.ts's and
 * button-variant-contract.test.ts's own header comments for this
 * repository's already-established precedent). This is therefore a
 * source-contract proxy, same as every other UI component test here —
 * genuine rendered-DOM/keyboard/focus/live-region proof is carried by the
 * E2E layer instead (test/e2e/attachments.spec.ts,
 * test/e2e/organization-setup.spec.ts), which runs against a real
 * Chromium instance.
 *
 * This file, and the two component source files it inspects, are never
 * imported/rendered here — only read as raw text via readFileSync, exactly
 * like every other contract test in this repo.
 */

const COMPONENT_PATH = "src/components/ui/file-input.tsx";

function readComponentSource(): string {
  if (!existsSync(COMPONENT_PATH)) {
    throw new Error(`${COMPONENT_PATH} does not exist yet`);
  }
  return readFileSync(COMPONENT_PATH, "utf-8");
}

/**
 * Comments stripped once, matching this repo's own established
 * migration-contract/seed-contract-test discipline — this component's own
 * doc comments legitimately discuss (in prose) some of the exact literal
 * strings ("display:none", "aria-hidden", "<label htmlFor>", "<button>")
 * the "forbidden content"/JSX-structure checks below scan for, which would
 * otherwise false-positive against prose rather than real code.
 */
function readComponentSourceCodeOnly(): string {
  return readComponentSource().replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("FileInput — reusable accessible file-picker component (source contract)", () => {
  it("the component file exists", () => {
    expect(existsSync(COMPONENT_PATH)).toBe(true);
  });

  it("renders a real native <input type=\"file\">", () => {
    const source = readComponentSource();
    expect(source).toMatch(/type=["']file["']/);
  });

  it("never uses display:none or the Tailwind 'hidden' utility to hide the native input", () => {
    const source = readComponentSourceCodeOnly();
    expect(source).not.toMatch(/display:\s*none/);
    // "hidden" as a standalone Tailwind utility class token (word-boundary),
    // never merely a substring of some other class/identifier.
    expect(source).not.toMatch(/\bhidden\b/);
  });

  it("never sets aria-hidden on the native input", () => {
    const source = readComponentSourceCodeOnly();
    // Bounded to the <input ...> tag itself, not the whole file (a filename
    // <span> is allowed to exist without aria-hidden anywhere near it, but
    // the guarantee here is specifically about the <input> element).
    const inputTag = source.match(/<input[\s\S]*?\/>/);
    expect(inputTag).not.toBeNull();
    expect(inputTag![0]).not.toMatch(/aria-hidden/);
  });

  it("visually hides the native input via the established sr-only convention, not a bespoke clip rule", () => {
    const source = readComponentSource();
    const inputTag = source.match(/<input[\s\S]*?\/>/)![0];
    expect(inputTag).toMatch(/\bsr-only\b/);
  });

  it("associates the native input with a real <label htmlFor=...> using the same id — never a nested interactive element inside that label", () => {
    const source = readComponentSourceCodeOnly();
    const idMatch = source.match(/<input[\s\S]*?\bid=\{?([a-zA-Z0-9_.]+)\}?/);
    expect(idMatch).not.toBeNull();
    expect(source).toMatch(new RegExp(`<label\\s+htmlFor=\\{?${idMatch![1]}\\}?`));
    // The label's own JSX subtree must contain no second interactive
    // element (<button>, a second <input>, <a href>) — the native file
    // input plus this one label is the only operable control.
    const labelOpenIndex = source.indexOf("<label");
    const labelCloseIndex = source.indexOf("</label>", labelOpenIndex);
    expect(labelOpenIndex).toBeGreaterThan(-1);
    expect(labelCloseIndex).toBeGreaterThan(labelOpenIndex);
    const labelBody = source.slice(labelOpenIndex, labelCloseIndex);
    expect(labelBody).not.toMatch(/<button/);
    expect(labelBody).not.toMatch(/<input/);
    expect(labelBody).not.toMatch(/<a\s+href/);
  });

  it("applies the app's standard focus-visible ring to the visible label surface via a peer-focus-visible variant, not a bespoke onFocus handler", () => {
    const source = readComponentSource();
    expect(source).toMatch(/\bpeer\b/);
    expect(source).toMatch(/peer-focus-visible:ring-2/);
    expect(source).toMatch(/peer-focus-visible:ring-black/);
    expect(source).not.toMatch(/onFocus=/);
  });

  it("never renders literal browser-native file-selector-button pseudo-class styling (the old file: pattern this PR replaces)", () => {
    const source = readComponentSource();
    expect(source).not.toMatch(/file:(mr|rounded|border|bg|px|py|text|font|hover:file)/);
  });

  it("displays the selected filename (or an empty-state label) through an aria-live=\"polite\" region driven by React state, not native browser text", () => {
    const source = readComponentSource();
    expect(source).toMatch(/aria-live=["']polite["']/);
    expect(source).toMatch(/useState/);
    expect(source).toMatch(/files\?\.\[0\]\?\.name/);
  });

  it("the empty-state label defaults to \"No file chosen\"", () => {
    const source = readComponentSource();
    expect(source).toMatch(/["']No file chosen["']/);
  });

  it("forwards name/accept/required/disabled/aria-invalid/aria-describedby to the native input, and calls a caller-supplied onChange in addition to its own internal handler", () => {
    const source = readComponentSource();
    const inputTag = source.match(/<input[\s\S]*?\/>/)![0];
    for (const attr of ["name=", "accept=", "required=", "disabled=", "aria-invalid=", "aria-describedby="]) {
      expect(inputTag).toContain(attr);
    }
    expect(source).toMatch(/onChange\?\.\(/);
  });

  it("synchronizes its displayed filename when the containing <form> resets, via a real native 'reset' event listener", () => {
    const source = readComponentSource();
    expect(source).toMatch(/addEventListener\(\s*["']reset["']/);
    expect(source).toMatch(/removeEventListener\(\s*["']reset["']/);
  });

  it("remains uncontrolled with respect to the file value — never assigns input.value or passes a `value` prop to the file input", () => {
    const source = readComponentSource();
    const inputTag = source.match(/<input[\s\S]*?\/>/)![0];
    expect(inputTag).not.toMatch(/\bvalue=/);
  });

  it("introduces no new dependency — imports only from react and this repo's own modules", () => {
    const source = readComponentSource();
    const importLines = source.match(/^import .+$/gm) ?? [];
    for (const line of importLines) {
      const fromMatch = line.match(/from\s+["']([^"']+)["']/);
      expect(fromMatch).not.toBeNull();
      const specifier = fromMatch![1];
      expect(specifier === "react" || specifier.startsWith("@/") || specifier.startsWith(".")).toBe(true);
    }
  });

  it("is a client component (uses browser state/effects, requires \"use client\")", () => {
    const source = readComponentSource();
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });
});
