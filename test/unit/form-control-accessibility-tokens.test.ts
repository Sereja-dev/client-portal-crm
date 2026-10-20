import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibility Improvement A3 — deterministic WCAG 1.4.11 (non-text
 * contrast) regression for the new --border-form-control token. Same
 * "parse the real src/app/globals.css as text" approach design-system-
 * foundation-tokens.test.ts and dark-mode-text-muted-contrast.test.ts
 * already established — every color here is derived from the actual
 * committed CSS, never duplicated as a second, independently-maintained
 * hex constant that could silently drift out of sync.
 *
 * Dark's own --border-form-control is an alpha-blended `rgba(...)`
 * (light-on-dark, matching --border-strong's own existing convention),
 * so contrast here requires compositing it over its real adjacent
 * background first — a plain hex-vs-hex luminance comparison would be
 * wrong for a translucent color.
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

type Rgb = { r: number; g: number; b: number };
type Rgba = Rgb & { a: number };

function parseColor(value: string): Rgba {
  if (value.startsWith("#")) {
    const hex = value.replace("#", "");
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!match) throw new Error(`Unrecognized color value: ${value}`);
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

// Standard "over" alpha compositing — the translucent color painted on
// top of an opaque background, producing the one effective solid color
// an eye (or a screen-reader-adjacent contrast checker) actually sees.
function compositeOver(fg: Rgba, bgValue: string): Rgb {
  const bg = parseColor(bgValue);
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_NON_TEXT_CONTRAST = 3;

describe("Accessibility Improvement A3 — --border-form-control contrast", () => {
  it("Light --border-form-control resolves to the approved #7C8595", () => {
    expect(declaredValueIn(LIGHT_BLOCK, "border-form-control")).toBe("#7C8595");
  });

  it("Dark --border-form-control resolves to the approved rgba(255, 255, 255, 0.40)", () => {
    expect(declaredValueIn(DARK_BLOCK, "border-form-control")).toBe("rgba(255, 255, 255, 0.40)");
  });

  it("--border-strong is unchanged in both themes — this slice never becomes a global border redesign", () => {
    expect(declaredValueIn(LIGHT_BLOCK, "border-strong")).toBe("#D1D5DB");
    expect(declaredValueIn(DARK_BLOCK, "border-strong")).toBe("rgba(255, 255, 255, 0.22)");
  });

  it("Light: passes WCAG 1.4.11 (>= 3:1) against every real adjacent background", () => {
    const border = parseColor(declaredValueIn(LIGHT_BLOCK, "border-form-control")!);
    const backgrounds = {
      "--surface": declaredValueIn(LIGHT_BLOCK, "surface")!, // var(--background) — resolved below
      "--surface-recessed": declaredValueIn(LIGHT_BLOCK, "surface-recessed")!,
    };
    // --surface is `var(--background)` in Light — resolve the alias
    // directly rather than hardcoding a second copy of its hex value.
    const resolvedSurface = backgrounds["--surface"].startsWith("var(")
      ? declaredValueIn(LIGHT_BLOCK, "background")!
      : backgrounds["--surface"];

    for (const [name, bg] of [
      ["--surface", resolvedSurface],
      ["--surface-recessed", backgrounds["--surface-recessed"]],
    ] as const) {
      const ratio = contrastRatio(border, parseColor(bg));
      expect(ratio, `--border-form-control vs ${name} (${bg}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        WCAG_NON_TEXT_CONTRAST,
      );
    }
  });

  it("Dark: correctly alpha-composites over each real adjacent background and passes WCAG 1.4.11 (>= 3:1)", () => {
    const border = parseColor(declaredValueIn(DARK_BLOCK, "border-form-control")!);
    expect(border.a).toBeLessThan(1); // sanity-check this really is translucent, not accidentally opaque

    const backgrounds = {
      "--surface": declaredValueIn(DARK_BLOCK, "surface")!,
      "--surface-recessed": declaredValueIn(DARK_BLOCK, "surface-recessed")!,
    };

    for (const [name, bg] of Object.entries(backgrounds)) {
      const effective = compositeOver(border, bg);
      const ratio = contrastRatio(effective, parseColor(bg));
      expect(ratio, `--border-form-control composited over ${name} (${bg}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        WCAG_NON_TEXT_CONTRAST,
      );
    }
  });
});
