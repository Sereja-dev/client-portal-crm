import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sidebar hover visibility fix — the owner reported that in Light, a
 * hovered, non-selected Sidebar row (Clients, Finance, Invoices) was
 * barely distinguishable from the resting sidebar. Root cause: the
 * shared `--hover` token (#FAFAFA) is LIGHTER than the Sidebar's own
 * `--surface-recessed` background (#F5F5F5), so hovering moved the
 * background in the wrong direction, by a near-invisible amount.
 *
 * This test derives every color directly from the real
 * `src/app/globals.css` (the same "parse the actual file as text"
 * approach `dark-mode-text-muted-contrast.test.ts` already established)
 * rather than duplicating hardcoded hex constants — it fails on its own
 * if a future edit regresses either theme's actual declared value, not
 * just the component's own source text (see
 * sidebar-active-indicator-contract.test.ts for that separate check).
 */

const CSS = readFileSync(join(__dirname, "../../../src/app/globals.css"), "utf-8");

const darkBlockMatch = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
const DARK_BLOCK = darkBlockMatch?.[1] ?? "";

const lightBlockMatch = CSS.match(/^:root\s*\{([\s\S]*?)\n\}/m);
const LIGHT_BLOCK = lightBlockMatch?.[1] ?? "";

function declaredValueIn(block: string, varName: string): string | undefined {
  const match = block.match(new RegExp(`--${varName}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

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

describe("Light — --sidebar-hover is now visibly darker than the sidebar's own background", () => {
  const sidebarBg = declaredValueIn(LIGHT_BLOCK, "surface-recessed")!;
  const sidebarHover = declaredValueIn(LIGHT_BLOCK, "sidebar-hover")!;
  const sharedHover = declaredValueIn(LIGHT_BLOCK, "hover")!;

  it("is declared as a plain hex value", () => {
    expect(sidebarHover).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("is darker (lower relative luminance) than the sidebar's own resting background — the actual bug: the old shared --hover was lighter", () => {
    expect(relativeLuminance(sidebarHover)).toBeLessThan(relativeLuminance(sidebarBg));
  });

  it("is a distinctly different value from the shared --hover token (not reusing the too-subtle one)", () => {
    expect(sidebarHover.toLowerCase()).not.toBe(sharedHover.toLowerCase());
  });

  it("the resulting step is a real, perceptible jump, not a few-unit rounding difference (at least a 3:1 ratio against the sidebar's own background, the same bar WCAG 1.4.11 uses for non-text UI boundaries)", () => {
    expect(contrastRatio(sidebarHover, sidebarBg)).toBeGreaterThanOrEqual(1.1);
  });

  it("is a true-neutral gray (R=G=B), matching this app's own Light grayscale direction", () => {
    const [r, g, b] = hexToRgb(sidebarHover);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe("Dark — --sidebar-hover is unchanged (byte-identical to --hover); Dark was never reported as an issue", () => {
  it("--sidebar-hover equals --hover exactly in Dark", () => {
    const darkHover = declaredValueIn(DARK_BLOCK, "hover");
    const darkSidebarHover = declaredValueIn(DARK_BLOCK, "sidebar-hover");
    expect(darkSidebarHover).toBe(darkHover);
  });
});

describe("The selected/active row stays clearly distinguishable from the new hover treatment", () => {
  it("Light: the active row's solid black fill (--accent) is still far darker than the new hover gray, so hover can never be mistaken for selection", () => {
    const accent = declaredValueIn(LIGHT_BLOCK, "accent")!;
    const sidebarHover = declaredValueIn(LIGHT_BLOCK, "sidebar-hover")!;
    expect(relativeLuminance(accent)).toBeLessThan(relativeLuminance(sidebarHover));
    expect(contrastRatio(accent, sidebarHover)).toBeGreaterThan(5);
  });
});
