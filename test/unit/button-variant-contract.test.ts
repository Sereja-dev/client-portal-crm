import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Correction — Invoice System Slice 4 post-deploy fix. A production defect
 * (reproduced directly: real computed styles showed color:rgb(255,255,255)
 * on backgroundColor:rgb(255,255,255) — genuinely invisible button text)
 * traced to Button's own base classes ("bg-black ... text-white") and a
 * caller-appended override className ("bg-white text-gray-900 ...")
 * sharing equal CSS specificity — which one wins a same-specificity
 * conflict is decided by the compiled stylesheet's own utility order (a
 * Tailwind content-scan/build-time detail), never by the className
 * string's own left-to-right order. `variant` replaces that fragile
 * pattern with a set of mutually exclusive class strings — exactly one is
 * ever rendered per element — that can never combine to conflict at all.
 * A third variant (dangerOutline) was added in the consistency-pass
 * follow-up to close the same latent risk on InvoiceLifecycleControls'
 * Cancel invoice button, which used a distinct text-red-600 override.
 *
 * No DOM/component-rendering harness exists in this repo (see
 * invoice-issue-controls-contract.test.ts's own header comment) — this is
 * therefore a source-contract proxy, same as every other component test
 * here, plus a real computed-style E2E proof (test/e2e/invoices.spec.ts).
 *
 * Visual Design Improvement V1 — `ghost` (low-emphasis) and `danger`
 * (solid destructive) added to ALL_VARIANTS below, so every generic check
 * in this file (non-empty, no internally-conflicting bg/text color, no
 * raw literal colors) automatically covers them too; dedicated
 * `danger`-specific assertions follow in their own describe block.
 */

const source = readFileSync("src/components/ui/button.tsx", "utf8");
const globalsCssSource = readFileSync("src/app/globals.css", "utf8");

const ALL_VARIANTS = ["primary", "secondary", "dangerOutline", "ghost", "danger"] as const;
type Variant = (typeof ALL_VARIANTS)[number];

function extractClassValue(variant: Variant): string {
  const match = source.match(new RegExp(`${variant}:\\s*"([^"]*)"`));
  expect(match).not.toBeNull();
  return match![1];
}

// Matches a genuine Tailwind color utility (bg-black, text-white,
// bg-gray-900, text-red-500, ...) — deliberately excludes non-color
// text-* utilities that share the same prefix (text-sm, text-center,
// text-left, ...), which are sizing/alignment, not color, and must never
// be flagged as a same-property conflict. "accent"/"surface"/"danger" are
// Aqenra custom Tailwind v4 theme colors (globals.css's --color-accent /
// --color-surface / --color-danger) — without them here, bg-accent/
// bg-surface would silently stop being recognized as color utilities at
// all, quietly disabling this test's own "background and foreground
// utilities must never be the same color" check for exactly the variants
// (primary, then secondary/dangerOutline via Design System Phase 2) this
// same historical bug originally hit. "text-text-primary"/
// "text-text-secondary" (etc.) are matched via the trailing
// `(-[a-z]+)?` group — Tailwind's own semantic-category-echoes-prefix
// naming quirk (see globals.css's own comment on this), not a mistake.
// Visual Design Improvement V1 — "danger-button(-hover)?" added for the
// same reason: without it, bg-danger-button/hover:bg-danger-button-hover
// would silently stop being recognized, quietly disabling this check for
// the new solid `danger` variant specifically.
const COLOR_UTILITY_PATTERN =
  /^(bg|text)-(black|white|transparent|current|inherit|accent|surface|danger(-subtle)?|danger-button(-hover)?|text-(primary|secondary|muted|inverse)|[a-z]+-\d{2,3})$/;

function tailwindColorUtilities(classString: string): string[] {
  return classString.split(/\s+/).filter((cls) => COLOR_UTILITY_PATTERN.test(cls));
}

describe("Button — variant classes never overlap on the same color utility (contract)", () => {
  it("every variant exists as a distinct, non-empty class string", () => {
    for (const variant of ALL_VARIANTS) {
      expect(extractClassValue(variant).length).toBeGreaterThan(0);
    }
  });

  it("no variant's own class string is itself internally self-conflicting (at most one bg-* and one text-* utility each, and never the identical utility for both)", () => {
    // Two DIFFERENT variants sharing a bg-* or text-* utility (e.g.
    // secondary and dangerOutline both using bg-white) is fine and
    // expected — variant is a single mutually-exclusive selection, so two
    // variants' classes are never both applied to one element at once.
    // The real invariant carried over from the original bug is narrower:
    // within ONE variant's own class string, its background and
    // foreground utilities must never be the same color (that is what
    // "invisible button text" actually means), and neither utility may
    // appear more than once (which would itself be ambiguous).
    for (const variant of ALL_VARIANTS) {
      const colors = tailwindColorUtilities(extractClassValue(variant));
      const bg = colors.filter((c) => c.startsWith("bg-"));
      const text = colors.filter((c) => c.startsWith("text-"));
      expect(bg.length).toBeLessThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(1);
      if (bg.length === 1 && text.length === 1) {
        expect(bg[0].replace(/^bg-/, "")).not.toBe(text[0].replace(/^text-/, ""));
      }
    }
  });

  it("the default variant is primary, so every existing caller that never passed `variant` renders unchanged", () => {
    expect(source).toMatch(/variant\s*=\s*"primary"/);
  });

  it("the rendered className applies the resolved variant classes, never a hardcoded color utility outside VARIANT_CLASSES", () => {
    const renderedTemplate = source.match(/className=\{`([^`]*)`\}/);
    expect(renderedTemplate).not.toBeNull();
    const literalColorUtilities = tailwindColorUtilities(renderedTemplate![1]);
    expect(literalColorUtilities).toEqual([]);
  });

  // Aqenra brand PR 2 — the primary variant's own accent color, proven
  // directly rather than only via the generic same-color-conflict check
  // above: it must use the Aqenra accent tokens (globals.css), never the
  // old bg-black/hover:bg-gray-800 pair.
  it("the primary variant uses the Aqenra accent tokens, not the old black background", () => {
    const primary = extractClassValue("primary");
    expect(primary).toContain("bg-accent");
    expect(primary).toContain("hover:bg-accent-hover");
    expect(primary).not.toMatch(/\bbg-black\b/);
    expect(primary).not.toMatch(/hover:bg-gray-800\b/);
    // White foreground is unchanged by this brand correction.
    expect(primary).toContain("text-white");
  });

  // Design System Phase 2 — secondary/dangerOutline's raw
  // border-gray-300/bg-white/text-gray-900/text-red-600 are replaced with
  // semantic tokens so both variants render correctly on Dark's own
  // surface. text-danger (not a literal red) is deliberate: it's a text
  // color, never a solid white-on-fill button background — see this
  // variant's own doc comment in button.tsx for why --danger specifically
  // must not be used that way.
  it("secondary and dangerOutline use semantic surface/border/text tokens, never the old raw grays", () => {
    for (const variant of ["secondary", "dangerOutline"] as const) {
      const classes = extractClassValue(variant);
      expect(classes).toContain("bg-surface");
      expect(classes).toContain("border-border-strong");
      expect(classes).not.toMatch(/\bbg-white\b/);
      expect(classes).not.toMatch(/\btext-gray-\d+\b/);
      expect(classes).not.toMatch(/\bborder-gray-\d+\b/);
      expect(classes).not.toMatch(/hover:bg-gray-\d+\b/);
    }
    expect(extractClassValue("secondary")).toContain("text-text-primary");
    expect(extractClassValue("dangerOutline")).toContain("text-danger");
    expect(extractClassValue("dangerOutline")).not.toMatch(/\btext-red-\d+\b/);
  });

  // The shared focus-visible ring (rendered outside VARIANT_CLASSES, in
  // the button's own base classes) must use the semantic --focus-ring
  // token, not the old literal black — illegible on a Dark surface.
  it("the shared focus-visible ring uses the semantic focus-ring token, not the old literal black", () => {
    const renderedTemplate = source.match(/className=\{`([^`]*)`\}/);
    expect(renderedTemplate).not.toBeNull();
    expect(renderedTemplate![1]).toContain("focus-visible:ring-focus-ring");
    expect(renderedTemplate![1]).not.toMatch(/focus-visible:ring-black\b/);
  });

  // Visual Design Improvement V1, requirement §4 — a true low-emphasis
  // "ghost": no resting background/border utility at all, text uses the
  // existing semantic secondary-text token (never a literal gray), and
  // its only interactive treatment is the same --hover wash
  // secondary/Sidebar/Appearance-selector already rely on (never a new
  // hover token, never a literal color).
  it("ghost has no resting background or border utility, uses the semantic secondary-text token, and hovers via the shared --hover wash", () => {
    const ghost = extractClassValue("ghost");
    expect(ghost).toContain("text-text-secondary");
    expect(ghost).toContain("hover:bg-[var(--hover)]");
    expect(ghost).not.toMatch(/(?<!hover:)\bbg-(?!\[var\(--hover\)\])[a-z-]+\b/);
    expect(ghost).not.toMatch(/\bborder\b/);
    expect(ghost).not.toMatch(/\bbg-(white|gray-\d+|black)\b/);
    expect(ghost).not.toMatch(/\btext-gray-\d+\b/);
  });

  // Visual Design Improvement V1, requirement §5 — the solid danger
  // variant must use the two new DEDICATED danger-button tokens, never
  // the generic --danger/--danger-subtle (calibrated as text/border, not
  // a solid fill — see this variant's own button.tsx comment) and never
  // a literal red/bg-red-* (the exact pattern this migration removes
  // from ConfirmDialog).
  it("danger uses the dedicated danger-button fill/hover tokens and the semantic inverse-text token, never --danger/--danger-subtle or a literal red", () => {
    const danger = extractClassValue("danger");
    const tokens = danger.split(/\s+/);
    expect(danger).toContain("bg-danger-button");
    expect(danger).toContain("hover:bg-danger-button-hover");
    expect(danger).toContain("text-text-inverse");
    // Exact-token checks (not substring regexes) — "bg-danger-button"
    // legitimately contains "bg-danger" as a substring, so a boundary
    // regex here would false-positive on the very token this variant is
    // required to use.
    expect(tokens).not.toContain("bg-danger");
    expect(tokens).not.toContain("bg-danger-subtle");
    expect(danger).not.toMatch(/\bbg-red-\d+\b/);
    expect(danger).not.toMatch(/\btext-white\b/);
    expect(danger).not.toMatch(/focus-visible:ring-red-\d+\b/);
  });
});

/**
 * Visual Design Improvement V1, requirement §5 — the new danger-button
 * tokens must independently prove WCAG AA (>= 4.5:1 for normal text)
 * white-on-fill, in both Light and Dark, for both the resting fill and
 * the hover fill — not merely asserted in a comment. Same exact
 * WCAG relative-luminance formula globals.css's own A2/A3 corrections
 * already use, computed here directly from the real hex values declared
 * in globals.css (extracted by name, not re-typed) so this test fails if
 * either token's value ever drifts without a contrast re-check.
 */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = "#FFFFFF";
const WCAG_AA_NORMAL_TEXT = 4.5;

/** Extracts a hex value declared as `--token: #RRGGBB;` from a given slice of globals.css (the :root block or the :root[data-theme="dark"] block), so Light/Dark don't accidentally read each other's value for the same token name. */
function extractToken(cssSlice: string, token: string): string {
  const match = cssSlice.match(new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})\\s*;`));
  expect(match, `expected --${token} to be declared as a plain #hex value in this CSS slice`).not.toBeNull();
  return match![1];
}

const darkBlockStart = globalsCssSource.indexOf(':root[data-theme="dark"]');
if (darkBlockStart === -1) {
  throw new Error('globals.css no longer has a :root[data-theme="dark"] block — Light/Dark token slices below would silently read the wrong block.');
}
const lightBlock = globalsCssSource.slice(0, darkBlockStart);
const darkBlock = globalsCssSource.slice(darkBlockStart);

describe("danger-button tokens — WCAG AA contrast proof (Light and Dark, base and hover)", () => {
  it("Light: --danger-button (resting fill) is white-on-fill >= 4.5:1", () => {
    const hex = extractToken(lightBlock, "danger-button");
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("Light: --danger-button-hover is white-on-fill >= 4.5:1", () => {
    const hex = extractToken(lightBlock, "danger-button-hover");
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("Dark: --danger-button (resting fill) is white-on-fill >= 4.5:1", () => {
    const hex = extractToken(darkBlock, "danger-button");
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("Dark: --danger-button-hover is white-on-fill >= 4.5:1", () => {
    const hex = extractToken(darkBlock, "danger-button-hover");
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  // Dark's own base/hover values are the Light pair with roles swapped
  // (documented in globals.css) — proven directly rather than just
  // trusting the comment, so this fails if that relationship is ever
  // silently broken.
  it("Dark reuses the exact same two hex values as Light, with base/hover roles swapped", () => {
    const lightBase = extractToken(lightBlock, "danger-button");
    const lightHover = extractToken(lightBlock, "danger-button-hover");
    const darkBase = extractToken(darkBlock, "danger-button");
    const darkHover = extractToken(darkBlock, "danger-button-hover");
    expect(darkBase).toBe(lightHover);
    expect(darkHover).toBe(lightBase);
  });
});
