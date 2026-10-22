import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Visual Design Improvement V2 — source-contract proxy for the new shared
 * DialogShell/DialogTitle/DialogDescription/DialogActions primitive (no
 * DOM/component-rendering harness exists in this repo — see
 * button-variant-contract.test.ts's own header comment for the same
 * reasoning). Real behavior-level proof that dialogs built on this shell
 * still open/close/focus/submit correctly already exists and is
 * untouched: test/e2e/confirm-dialog.spec.ts plus each migrated feature
 * dialog's own existing E2E coverage. This file proves only what those
 * suites cannot see directly — the shell's own visual class contract.
 */

const source = readFileSync("src/components/ui/dialog-shell.tsx", "utf8");

describe("DialogShell — renders the real native <dialog>, never a custom role=\"dialog\" wrapper", () => {
  it("the underlying element is a real <dialog>, not a div with role=\"dialog\"", () => {
    expect(source).toMatch(/<dialog\b/);
    expect(source).not.toMatch(/role="dialog"/);
  });

  it("forwards DialogHTMLAttributes props (ref/onClick/aria-*) directly onto the <dialog> — never intercepts or wraps them", () => {
    expect(source).toMatch(/DialogHTMLAttributes<HTMLDialogElement>/);
    expect(source).toMatch(/ref=\{ref\}/);
    expect(source).toMatch(/\{\.\.\.props\}/);
  });

  it("applies the existing DIALOG_CENTER_CLASSES fix, unchanged — never redefines centering itself", () => {
    expect(source).toMatch(/import\s*\{\s*DIALOG_CENTER_CLASSES\s*\}\s*from\s*"\.\/dialog-classes"/);
    expect(source).toMatch(/\$\{DIALOG_CENTER_CLASSES\}/);
  });

  it("uses semantic surface/border tokens, never literal bg-white/border-gray-*", () => {
    const shellClassMatch = source.match(/className=\{`([^`]*)`\}/);
    expect(shellClassMatch).not.toBeNull();
    const classes = shellClassMatch![1];
    expect(classes).toContain("bg-surface");
    expect(classes).toContain("border-border-default");
    expect(classes).not.toMatch(/\bbg-white\b/);
    expect(classes).not.toMatch(/\bborder-gray-\d+\b/);
    expect(classes).not.toMatch(/\btext-black\b/);
  });

  it("wires the dormant --aqenra-radius-lg/--aqenra-shadow-lg tokens via Tailwind arbitrary-value syntax, never a changed token value", () => {
    const shellClassMatch = source.match(/className=\{`([^`]*)`\}/);
    const classes = shellClassMatch![1];
    expect(classes).toContain("rounded-[var(--aqenra-radius-lg)]");
    expect(classes).toContain("shadow-[var(--aqenra-shadow-lg)]");
    // Never the old plain Tailwind rounded-lg/shadow-xl every dialog
    // previously hardcoded individually.
    expect(classes).not.toMatch(/\brounded-lg\b/);
    expect(classes).not.toMatch(/\bshadow-xl\b/);
  });

  it("supports both existing dialog widths (max-w-sm default, max-w-md opt-in) without a fixed width that would break narrow viewports", () => {
    expect(source).toMatch(/sm:\s*"max-w-sm"/);
    expect(source).toMatch(/md:\s*"max-w-md"/);
    expect(source).toMatch(/maxWidth\s*=\s*"sm"/); // default
    expect(source).not.toMatch(/\bw-\[\d/); // no fixed pixel width
  });

  it("does not own open/close/focus/Escape/submit state — no useState, no event listener registration, no showModal/close call", () => {
    expect(source).not.toMatch(/useState/);
    expect(source).not.toMatch(/useEffect/);
    expect(source).not.toMatch(/addEventListener/);
    expect(source).not.toMatch(/\.showModal\(\)/);
    expect(source).not.toMatch(/\.close\(\)/);
  });
});

describe("DialogTitle / DialogDescription — unchanged typography from the existing dialog pattern", () => {
  it("DialogTitle uses the existing text-base font-semibold title treatment, semantic text-text-primary", () => {
    const match = source.match(/function DialogTitle[\s\S]*?className="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("text-text-primary");
    expect(match![1]).toContain("text-base");
    expect(match![1]).toContain("font-semibold");
  });

  it("DialogDescription uses the existing mt-2 text-sm description treatment, semantic text-text-secondary", () => {
    const match = source.match(/function DialogDescription[\s\S]*?className="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("text-text-secondary");
    expect(match![1]).toContain("text-sm");
  });
});

describe("DialogActions — shared action-row layout only, never a button of its own", () => {
  it("renders the existing flex justify-end gap-3 action-row layout", () => {
    const match = source.match(/function DialogActions[\s\S]*?className="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("flex");
    expect(match![1]).toContain("justify-end");
    expect(match![1]).toContain("gap-3");
  });

  it("never renders a <button>/<Button> itself — purely a layout wrapper around caller-supplied children", () => {
    const fnMatch = source.match(/function DialogActions\([\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/<button\b/);
    expect(fnMatch![0]).not.toMatch(/<Button\b/);
    expect(fnMatch![0]).toMatch(/\{children\}/);
  });
});
