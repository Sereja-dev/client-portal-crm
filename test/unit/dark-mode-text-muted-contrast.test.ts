import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibility Improvement A2 — deterministic WCAG contrast regression
 * for dark-mode `--text-muted`. Derives every color directly from the
 * real `src/app/globals.css` (the same "parse the actual file as text"
 * approach `design-system-foundation-tokens.test.ts` already
 * established, reusing its exact `declaredValue`/`declaredValueInDarkBlock`
 * shape) rather than duplicating hardcoded hex constants that could
 * silently drift out of sync with the file if either side is ever
 * edited independently.
 *
 * `--text-muted` is painted directly on four real backgrounds in Dark
 * mode (confirmed by source audit, not assumed): `--surface`
 * (RecordCardField labels, EmptyState copy, Input/Select/Textarea/
 * SearchableSelect placeholder text — formControlClasses()'s own
 * `placeholder:text-text-muted`), `--surface-muted` (the GlobalSearch
 * ⌘K kbd hint), `--surface-recessed` (TableHeaderCell, and — since
 * (dashboard)/layout.tsx's own content area is itself `bg-surface-
 * recessed` with no card wrapper — most FormField helper-text
 * surfaces too), and the bare `--background`. All four must clear
 * WCAG AA's 4.5:1 normal-text minimum.
 */

const CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf-8");

const darkBlockMatch = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
const DARK_BLOCK = darkBlockMatch?.[1] ?? "";

const lightBlockMatch = CSS.match(/^:root\s*\{([\s\S]*?)\n\}/m);
const LIGHT_BLOCK = lightBlockMatch?.[1] ?? "";

function declaredValueIn(block: string, varName: string): string | undefined {
  const match = block.match(new RegExp(`--${varName}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

// WCAG 2.x relative-luminance contrast ratio — plain arithmetic, no
// color-math dependency (matching the file's own PLATFORM_ADMIN_DARK_
// ACCENT_CONTRAST_CORRECTION comment's own stated verification method).
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe("Accessibility Improvement A2 — dark-mode --text-muted contrast", () => {
  it("dark --text-muted resolves to the approved #868C97", () => {
    expect(declaredValueIn(DARK_BLOCK, "text-muted")).toBe("#868C97");
  });

  it("passes WCAG AA (>= 4.5:1) against every real dark-mode background it is actually painted on", () => {
    const textMuted = declaredValueIn(DARK_BLOCK, "text-muted")!;
    const backgrounds = {
      "--surface": declaredValueIn(DARK_BLOCK, "surface")!,
      "--surface-muted": declaredValueIn(DARK_BLOCK, "surface-muted")!,
      "--surface-recessed": declaredValueIn(DARK_BLOCK, "surface-recessed")!,
      "--background": declaredValueIn(DARK_BLOCK, "background")!,
    };

    for (const [name, background] of Object.entries(backgrounds)) {
      const ratio = contrastRatio(textMuted, background);
      expect(ratio, `--text-muted (${textMuted}) vs ${name} (${background}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("stays visibly quieter than --text-secondary — the fix must not collapse muted text into the secondary tier", () => {
    const textMuted = declaredValueIn(DARK_BLOCK, "text-muted")!;
    const textSecondary = declaredValueIn(DARK_BLOCK, "text-secondary")!;
    const surface = declaredValueIn(DARK_BLOCK, "surface")!;

    const mutedRatio = contrastRatio(textMuted, surface);
    const secondaryRatio = contrastRatio(textSecondary, surface);

    expect(mutedRatio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(mutedRatio, "muted must still read as quieter than secondary, not merge with it").toBeLessThan(secondaryRatio);
  });

  it("dark --disabled remains dimmer than dark --text-muted after this change (disabled state semantics untouched)", () => {
    // Same lexical-hex-comparison shorthand design-system-foundation-
    // tokens.test.ts's own identical assertion already uses — both
    // values here are still plain hex (no rgba), so this remains valid.
    const disabled = declaredValueIn(DARK_BLOCK, "disabled")!;
    const muted = declaredValueIn(DARK_BLOCK, "text-muted")!;
    expect(disabled.toLowerCase() < muted.toLowerCase()).toBe(true);
  });

  it("light-mode --text-muted is unchanged and still passes WCAG AA on its own real backgrounds", () => {
    const textMuted = declaredValueIn(LIGHT_BLOCK, "text-muted")!;
    expect(textMuted).toBe("#6B7280");

    const background = declaredValueIn(LIGHT_BLOCK, "background")!;
    const surfaceMuted = declaredValueIn(LIGHT_BLOCK, "surface-muted")!;

    expect(contrastRatio(textMuted, background)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(textMuted, surfaceMuted)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});
