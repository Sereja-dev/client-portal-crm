import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Visual Design Improvement V1 — source-contract proxy for ConfirmDialog's
 * destructive-action migration (no DOM/component-rendering harness exists
 * in this repo — see button-variant-contract.test.ts's own header comment
 * for the same reasoning). Real behavior-level proof that the migrated
 * dialog still opens/cancels/confirms/persists exactly as before already
 * exists and is untouched: test/e2e/confirm-dialog.spec.ts. This file
 * proves only the one thing that test suite cannot see directly — which
 * concrete implementation (the shared Button primitive vs. a raw literal
 * className) the destructive branch actually renders through.
 *
 * Visual Design Improvement V2 — ConfirmDialog's own native <dialog>/
 * DIALOG_CENTER_CLASSES markup moved into the new shared DialogShell
 * (dialog-shell.tsx); the "native dialog architecture unchanged" check
 * below now asserts ConfirmDialog renders <DialogShell> (not a literal
 * <dialog>) — dialog-shell-contract.test.ts separately proves DialogShell
 * itself still carries the real <dialog>/DIALOG_CENTER_CLASSES markup.
 */

const source = readFileSync("src/components/ui/confirm-dialog.tsx", "utf8");

/** Mirrors test/unit/ai/ai-assistant-source-contract.test.ts's own stripComments() exactly (a separate, test-local copy, not an import — same reason it exists there) — a real call-site/markup check must not be defeated by this file's own migration-note prose that legitimately names the old literal classes it removed. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const renderedSource = stripComments(source);

describe("ConfirmDialog — destructive action migrated to the shared Button `danger` variant", () => {
  it("imports Button from the shared primitive", () => {
    expect(source).toMatch(/import\s*\{\s*Button\s*\}\s*from\s*"\.\/button"/);
  });

  it("the destructive branch renders <Button variant=\"danger\">, never the old literal bg-red-600/hover:bg-red-700/focus-visible:ring-red-600 (comment-stripped: this file's own migration-note prose legitimately names the removed literal classes)", () => {
    expect(renderedSource).toMatch(/<Button\b[^>]*variant="danger"/);
    expect(renderedSource).not.toMatch(/\bbg-red-\d+\b/);
    expect(renderedSource).not.toMatch(/hover:bg-red-\d+\b/);
    expect(renderedSource).not.toMatch(/focus-visible:ring-red-\d+\b/);
  });

  it("the non-destructive confirm branch is untouched — still a raw button with the original accent fill, not migrated in this slice", () => {
    expect(source).toMatch(/<button\b[\s\S]*?bg-accent[\s\S]*?hover:bg-accent-hover/);
  });

  it("Cancel is untouched — still a raw button with its own original secondary-text styling, not converted to the shared Button `secondary` variant in this slice", () => {
    const cancelButtonMatch = source.match(/onClick=\{\(\)\s*=>\s*dialogRef\.current\?\.close\(\)\}[\s\S]{0,300}/);
    expect(cancelButtonMatch).not.toBeNull();
    expect(cancelButtonMatch![0]).toContain("text-text-secondary");
    expect(cancelButtonMatch![0]).toContain("hover:bg-[var(--hover)]");
  });

  it("renders via the shared DialogShell (native <dialog>/DIALOG_CENTER_CLASSES now live there — see dialog-shell-contract.test.ts), with labelling/backdrop-close/showModal unchanged on ConfirmDialog's own side", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bDialogShell\b[^}]*\}\s*from\s*"\.\/dialog-shell"/);
    expect(renderedSource).toMatch(/<DialogShell\b/);
    // Comment-stripped: this file's own top doc comment legitimately
    // describes ConfirmDialog as "built on the native <dialog> element"
    // in prose — only the real rendered markup must never reintroduce a
    // literal <dialog> tag now that DialogShell owns it.
    expect(renderedSource).not.toMatch(/<dialog\b/);
    expect(source).toMatch(/aria-labelledby=\{titleId\}/);
    expect(source).toMatch(/aria-describedby=\{descriptionId\}/);
    expect(source).toMatch(/showModal\(\)/);
  });

  it("both the danger Button and the non-destructive raw button close the dialog before calling onConfirm, in the same order as before", () => {
    const matches = [...source.matchAll(/dialogRef\.current\?\.close\(\);\s*onConfirm\(\);/g)];
    expect(matches.length).toBe(2);
  });

  it("the migrated Button still passes type=\"button\" explicitly, same as the raw button it replaced (never an implicit submit type inside the dialog)", () => {
    const destructiveBranch = source.match(/destructive\s*\?\s*\([\s\S]*?<Button\b[\s\S]*?<\/Button>/);
    expect(destructiveBranch).not.toBeNull();
    expect(destructiveBranch![0]).toMatch(/type="button"/);
  });
});
