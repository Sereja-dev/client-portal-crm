import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design System Phase 1 (foundation tokens) + Phase 1b (dark token
// values). This suite exercises src/app/globals.css as plain text —
// there is no component under test yet, since nothing in src/ consumes
// these tokens in this PR (see the PR description). The assertions
// below are deliberately narrow: they check that specific variable
// declarations exist with the expected value, not a snapshot of the
// whole file's formatting, so future additive changes to this file
// (Phase 2+) won't spuriously fail this suite unless they touch one of
// the specific guarantees below.
const CSS = readFileSync(
  join(__dirname, "../../src/app/globals.css"),
  "utf-8",
);

const ROOT_LAYOUT = readFileSync(
  join(__dirname, "../../src/app/layout.tsx"),
  "utf-8",
);

// A declaration line looks like `  --name: value;` (single or
// multi-line values are normalized away for the tokens this suite
// checks, since none of them span multiple lines). Matches the FIRST
// occurrence in the file, which — since the plain `:root` (Light)
// block always comes before the `:root[data-theme="dark"]` block below
// it — means every existing call site of this helper keeps checking
// Light's value, unaffected by Phase 1b adding a same-named dark
// declaration further down. Phase-1b-specific tests use
// declaredValueInDarkBlock() instead, scoped to the dark block only.
function declaredValue(varName: string): string | undefined {
  const match = CSS.match(
    new RegExp(`--${varName}\\s*:\\s*([^;]+);`),
  );
  return match?.[1]?.trim();
}

// Phase 1b: everything declared inside :root[data-theme="dark"] { ... },
// extracted once so dark-specific assertions can't accidentally match a
// Light declaration of the same name earlier in the file.
const darkBlockMatch = CSS.match(
  /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/,
);
const DARK_BLOCK = darkBlockMatch?.[1] ?? "";

function declaredValueInDarkBlock(varName: string): string | undefined {
  const match = DARK_BLOCK.match(new RegExp(`--${varName}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

// Every `--name` actually declared somewhere in the Light :root block —
// used to confirm the dark block never introduces a token name Light
// doesn't already have (no --success-dark, no stray new concept smuggled
// in alongside the dark values).
const lightBlockMatch = CSS.match(/^:root\s*\{([\s\S]*?)\n\}/m);
const LIGHT_BLOCK = lightBlockMatch?.[1] ?? "";
const LIGHT_TOKEN_NAMES = new Set(
  [...LIGHT_BLOCK.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

describe("design system foundation tokens — src/app/globals.css", () => {
  it("keeps background/foreground byte-identical, and Light's accent at its Sky-Blue/Grayscale Theme Redesign V1 black value", () => {
    expect(declaredValue("background")).toBe("#ffffff");
    expect(declaredValue("foreground")).toBe("#171717");
    expect(declaredValue("accent")).toBe("#000000");
    expect(declaredValue("accent-hover")).toBe("#262626");
  });

  it("declares every required semantic surface/text/border/brand/focus/semantic token", () => {
    const required = [
      "surface",
      "surface-recessed",
      "surface-elevated",
      "surface-muted",
      "text-primary",
      "text-secondary",
      "text-muted",
      "text-inverse",
      "border-subtle",
      "border-default",
      "border-strong",
      "accent-active",
      "accent-subtle",
      "accent-foreground",
      "focus-ring",
      "success",
      "success-subtle",
      "warning",
      "warning-subtle",
      "danger",
      "danger-subtle",
      "info",
      "info-subtle",
      "selected",
      "hover",
      "disabled",
    ];
    for (const name of required) {
      expect(declaredValue(name), `expected --${name} to be declared`).toBeDefined();
    }
  });

  it("resolves the documented legacy aliases exactly as intended", () => {
    expect(declaredValue("surface")).toBe("var(--background)");
    expect(declaredValue("surface-elevated")).toBe("var(--background)");
    expect(declaredValue("text-primary")).toBe("var(--foreground)");
    expect(declaredValue("selected")).toBe("var(--accent-subtle)");
  });

  it("sets --focus-ring to Tailwind's `black`, so a future wire-up of focus-visible:ring-black is a zero-diff swap", () => {
    expect(declaredValue("focus-ring")).toBe("#000000");
  });

  it("mirrors the color tokens (not the INTERACTIVE tokens) into @theme inline for future Tailwind utility generation", () => {
    const themeBlockMatch = CSS.match(/@theme inline \{([\s\S]*?)\n\}/);
    expect(themeBlockMatch).toBeTruthy();
    const themeBlock = themeBlockMatch![1];

    for (const mirrored of [
      "surface",
      "surface-recessed",
      "surface-elevated",
      "surface-muted",
      "text-primary",
      "text-secondary",
      "text-muted",
      "text-inverse",
      "border-subtle",
      "border-default",
      "border-strong",
      "accent-active",
      "accent-subtle",
      "accent-foreground",
      "focus-ring",
      "success",
      "success-subtle",
      "warning",
      "warning-subtle",
      "danger",
      "danger-subtle",
      "info",
      "info-subtle",
    ]) {
      expect(
        themeBlock,
        `expected @theme inline to mirror --color-${mirrored}`,
      ).toMatch(new RegExp(`--color-${mirrored}\\s*:\\s*var\\(--${mirrored}\\)`));
    }

    // INTERACTIVE tokens are intentionally NOT mirrored (see the code
    // comment) — a bare `bg-hover`/`bg-disabled` Tailwind utility would
    // read confusingly next to the real hover:/disabled: variants.
    expect(themeBlock).not.toMatch(/--color-selected\s*:/);
    expect(themeBlock).not.toMatch(/--color-hover\s*:/);
    expect(themeBlock).not.toMatch(/--color-disabled\s*:/);
  });

  it("never redeclares Tailwind's own reserved --radius-*/--shadow-*/--spacing theme keys (would silently restyle every existing rounded-*/shadow-* utility app-wide)", () => {
    for (const reserved of [
      "radius-sm",
      "radius-md",
      "radius-lg",
      "radius-xl",
      "shadow-sm",
      "shadow-md",
      "shadow-lg",
      "shadow-xl",
      "spacing",
    ]) {
      expect(
        declaredValue(reserved),
        `--${reserved} must not be redeclared — it collides with Tailwind's own default theme`,
      ).toBeUndefined();
    }
  });

  it("introduces the new radius/shadow foundation only under the collision-safe --aqenra- prefix", () => {
    expect(declaredValue("aqenra-radius-sm")).toBe("6px");
    expect(declaredValue("aqenra-radius-md")).toBe("8px");
    expect(declaredValue("aqenra-radius-lg")).toBe("12px");
    expect(declaredValue("aqenra-radius-full")).toBe("999px");
    expect(CSS).toMatch(/--aqenra-shadow-sm\s*:/);
    expect(CSS).toMatch(/--aqenra-shadow-md\s*:/);
    expect(CSS).toMatch(/--aqenra-shadow-lg\s*:/);
  });

  it("Phase 1b: the dark override is CSS-only — no prefers-color-scheme media query, no dark: Tailwind variant, and the default (unscoped) color-scheme stays light", () => {
    // Tailwind's `dark:` variant is a JSX className prefix, not something
    // that would ever appear in this CSS file, so it isn't checked here —
    // this file's own header comment literally contains the substring
    // "dark:" while explaining that no such variants exist, which would
    // make that check a guaranteed false positive.
    //
    // prefers-color-scheme is deliberately absent: Phase 1b defines dark
    // VALUES only, selected exclusively by the `data-theme` attribute — a
    // media-query-driven System mode is real future resolver behavior
    // (Phase B), not something this CSS-only PR should pre-empt.
    expect(CSS).not.toMatch(/prefers-color-scheme/);
    expect(declaredValue("color-scheme")).toBeUndefined(); // it's a plain property, not a custom property
    expect(CSS).toMatch(/^\s*color-scheme:\s*light;/m);
  });

  it("Phase 1b: declares a dark override block, selected only by [data-theme=\"dark\"]", () => {
    expect(DARK_BLOCK.length, "expected a :root[data-theme=\"dark\"] block to exist").toBeGreaterThan(0);
  });

  it("Phase 1b: every token the app actually consumes has a dark value, under the identical semantic name", () => {
    const required = [
      "background",
      "foreground",
      "accent",
      "accent-hover",
      "accent-active",
      "accent-subtle",
      "accent-foreground",
      "surface",
      "surface-recessed",
      "surface-elevated",
      "surface-muted",
      "text-primary",
      "text-secondary",
      "text-muted",
      "text-inverse",
      "border-subtle",
      "border-default",
      "border-strong",
      "focus-ring",
      "success",
      "success-subtle",
      "warning",
      "warning-subtle",
      "danger",
      "danger-subtle",
      "info",
      "info-subtle",
      "selected",
      "hover",
      "disabled",
    ];
    for (const name of required) {
      expect(
        declaredValueInDarkBlock(name),
        `expected --${name} to have a dark value`,
      ).toBeDefined();
    }
  });

  it("Phase 1b: introduces no theme-specific variable names (no --success-dark, --surface-light, etc.) — every dark declaration reuses a name Light already has", () => {
    const darkNames = [...DARK_BLOCK.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect(darkNames.length).toBeGreaterThan(0);
    for (const name of darkNames) {
      expect(
        LIGHT_TOKEN_NAMES.has(name),
        `--${name} appears in the dark block but not in Light — theme must never be encoded into the token name`,
      ).toBe(true);
      expect(name).not.toMatch(/-(dark|light)$/);
    }
  });

  it("Phase 1b: dark values are genuinely adapted, not the Light pastel/deep values reused verbatim", () => {
    expect(declaredValueInDarkBlock("background")).not.toBe(declaredValue("background"));
    expect(declaredValueInDarkBlock("accent")).not.toBe(declaredValue("accent"));
    expect(declaredValueInDarkBlock("success-subtle")).not.toBe(declaredValue("success-subtle"));
    expect(declaredValueInDarkBlock("focus-ring")).not.toBe(declaredValue("focus-ring"));
  });

  it("Phase 1b: dark --disabled is dimmer than dark --text-muted (a disabled control must never read as ordinary muted text)", () => {
    // Both are plain hex here (no rgba), so a lexical comparison of the
    // hex digits is a valid, simple stand-in for "darker/dimmer" without
    // pulling in a color-math dependency for one assertion.
    const disabled = declaredValueInDarkBlock("disabled");
    const muted = declaredValueInDarkBlock("text-muted");
    expect(disabled).toBeDefined();
    expect(muted).toBeDefined();
    expect(disabled!.toLowerCase() < muted!.toLowerCase()).toBe(true);
  });

  it("Phase 1b: sets color-scheme: dark, scoped only inside the dark block", () => {
    expect(DARK_BLOCK).toMatch(/color-scheme:\s*dark;/);
  });

  it("Phase 1b: still never redeclares Tailwind's reserved --radius-*/--shadow-*/--spacing keys, even inside the dark block", () => {
    for (const reserved of ["radius-sm", "radius-md", "radius-lg", "radius-xl", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl", "spacing"]) {
      expect(
        declaredValueInDarkBlock(reserved),
        `--${reserved} must not be redeclared in the dark block either`,
      ).toBeUndefined();
    }
    expect(DARK_BLOCK).toMatch(/--aqenra-shadow-sm\s*:/);
    expect(DARK_BLOCK).toMatch(/--aqenra-shadow-md\s*:/);
    expect(DARK_BLOCK).toMatch(/--aqenra-shadow-lg\s*:/);
  });

  it("Phase 1b: the dark block introduces no radius or typography override — shape/scale don't change by theme", () => {
    for (const shapeToken of ["aqenra-radius-sm", "aqenra-radius-md", "aqenra-radius-lg", "aqenra-radius-full", "aqenra-fs-body", "aqenra-fw-body"]) {
      expect(
        declaredValueInDarkBlock(shapeToken),
        `--${shapeToken} should not be overridden in the dark block — it's a shape/scale token, not a color`,
      ).toBeUndefined();
    }
  });

  it("Theme Resolver Phase B: root layout activates theming through the shared pre-paint script and ThemeProvider, not an ad hoc/duplicated mechanism", () => {
    // This assertion originally read `expect(ROOT_LAYOUT).not.toMatch(/data-theme/)`
    // — an accurate description of Phase 1b's own scope (dark token
    // VALUES, zero activation). Theme Resolver Phase B is the deliberate,
    // later PR that activates it for real; updating this assertion
    // (rather than deleting it) keeps this file's own history honest
    // about what changed and why. Full behavioral coverage of the
    // resolver itself lives in theme-resolve.test.ts, theme-pre-paint-
    // script.test.ts, and test/e2e/theme-resolver.spec.ts.
    //
    // Root layout deliberately renders a literal `data-theme="light"`
    // default (not a cookie-derived value) and does NOT import
    // @/lib/theme/resolve at all — see layout.tsx's own doc comment:
    // reading the theme cookie in the root layout would opt the whole
    // app out of static prerendering, so 100% of the cookie
    // reading/correcting happens in the pre-paint script instead.
    expect(ROOT_LAYOUT).toMatch(/data-theme="light"/);
    expect(ROOT_LAYOUT).toMatch(/suppressHydrationWarning/);
    expect(ROOT_LAYOUT).toMatch(/from "@\/lib\/theme\/pre-paint-script"/);
    expect(ROOT_LAYOUT).toMatch(/from "@\/components\/theme\/theme-provider"/);
    expect(ROOT_LAYOUT).not.toMatch(/from "@\/lib\/theme\/resolve"/);
    expect(ROOT_LAYOUT).not.toMatch(/next\/headers/);
  });
});
