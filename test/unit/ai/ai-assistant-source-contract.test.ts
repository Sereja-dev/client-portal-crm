import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AI Assistant staff drawer/UI batch — source-contract evidence,
 * matching this repo's own established pattern (e.g.
 * segment-error-boundaries-adoption-contract.test.ts): proves exact
 * wiring that a real click-simulated interaction test cannot express
 * here (no DOM/component-interaction harness). This is NOT a substitute
 * for real interaction evidence — see test/e2e/ai-assistant-drawer.spec.ts
 * for that.
 */

const PANEL_SOURCE = readFileSync("src/components/ai/ai-assistant-panel.tsx", "utf8");
const TRIGGER_SOURCE = readFileSync("src/components/ai/ai-assistant-trigger.tsx", "utf8");
const LAYOUT_SOURCE = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
const HEADER_SOURCE = readFileSync("src/components/layout/header.tsx", "utf8");
const CLIENT_SOURCE = readFileSync("src/lib/ai/client.ts", "utf8");

/** Every `from "..."` import specifier actually referenced by a file — deliberately excludes doc-comment prose that merely discusses a module by name (e.g. "must never import from src/lib/ai/orchestrate.ts" in a header comment), the same false-positive class the AI security-check script's own stripComments() discipline exists to avoid. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

/** Mirrors scripts/security-checks/check-ai-assistant-security.mjs's own stripComments() exactly — reused here (a separate, test-local copy, not an import, since that file is a plain Node script not built for import from a vitest module) for the same reason it exists there: a real call-site check must not be satisfied (or defeated) by prose that merely discusses the same syntax in a comment. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ai-assistant-panel.tsx — source-contract wiring", () => {
  it("uses the native <dialog> + showModal() pattern, not a custom modal implementation", () => {
    expect(PANEL_SOURCE).toMatch(/<dialog\b/);
    expect(PANEL_SOURCE).toMatch(/showModal\(\)/);
  });

  it("gates its own flex layout on Tailwind's open: variant, never a bare `flex`/`flex-col` class — a real, E2E-caught regression class: an unconditional `display:flex` on <dialog> overrides the browser's own `dialog:not([open]){display:none}` rule, making a 'closed' panel still cover and intercept clicks on whatever is behind it (including its own trigger)", () => {
    const classNameMatch = PANEL_SOURCE.match(/className="([^"]*backdrop:bg-black\/40[^"]*)"/);
    expect(classNameMatch).not.toBeNull();
    const tokens = classNameMatch![1].split(/\s+/);
    expect(tokens).toContain("open:flex");
    expect(tokens).toContain("open:flex-col");
    expect(tokens).not.toContain("flex"); // bare, unconditional flex would defeat the UA's own dialog:not([open]){display:none} rule
    expect(tokens).not.toContain("flex-col");
  });

  it("wires onClose to the panel's own reset function (abort + state clear on every close, whatever the trigger)", () => {
    expect(PANEL_SOURCE).toMatch(/onClose=\{resetState\}/);
    expect(PANEL_SOURCE).toContain("abortControllerRef.current?.abort()");
  });

  it("never handles Escape itself — must reach the native <dialog>'s own close handling unimpeded", () => {
    expect(PANEL_SOURCE).not.toMatch(/key\s*===\s*["']Escape["']/);
  });

  it("submits on Enter without Shift, and only then", () => {
    expect(PANEL_SOURCE).toMatch(/event\.key === "Enter" && !event\.shiftKey/);
  });

  it("declares the composer's maxLength as exactly 2000", () => {
    expect(PANEL_SOURCE).toMatch(/maxLength=\{MAX_MESSAGE_CHARS\}/);
    expect(PANEL_SOURCE).toMatch(/const MAX_MESSAGE_CHARS = 2000;/);
  });

  it("uses a fresh AbortController per submit and passes its signal through", () => {
    expect(PANEL_SOURCE).toMatch(/new AbortController\(\)/);
    expect(PANEL_SOURCE).toMatch(/askAiAssistant\([^)]*controller\.signal\)/);
  });

  it("guards against a stale response overwriting newer state via a generation counter", () => {
    expect(PANEL_SOURCE).toContain("generationRef.current");
  });

  it("never uses dangerouslySetInnerHTML anywhere", () => {
    expect(PANEL_SOURCE).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders the answer via plain whitespace-preserving JSX text interpolation only", () => {
    expect(PANEL_SOURCE).toMatch(/whitespace-pre-wrap[^"]*">\{answer\}/);
  });

  it("never references localStorage/sessionStorage/indexedDB", () => {
    expect(PANEL_SOURCE).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
  });

  it("copy uses navigator.clipboard only, never a server call, and is never logged", () => {
    expect(PANEL_SOURCE).toContain("navigator.clipboard.writeText(answer)");
    expect(PANEL_SOURCE).not.toMatch(/console\.(log|error|warn|info|debug)\(/);
  });

  it("never imports server-only AI internals — client.ts is the only src/lib/ai/ import", () => {
    const aiImports = [...PANEL_SOURCE.matchAll(/from\s+"([^"]*@\/lib\/ai[^"]*)"/g)].map((m) => m[1]);
    expect(aiImports).toEqual(["@/lib/ai/client"]);
  });

  it("never imports a Server Action / actions.ts file", () => {
    expect(PANEL_SOURCE).not.toMatch(/from\s+"[^"]*actions["']/);
  });
});

describe("ai-assistant-trigger.tsx — source-contract wiring", () => {
  it("renders a genuinely disabled native button when unavailable — no working click path", () => {
    const unavailableBlock = TRIGGER_SOURCE.slice(TRIGGER_SOURCE.indexOf("if (!available)"), TRIGGER_SOURCE.indexOf("return (\n    <>"));
    expect(unavailableBlock).toMatch(/\bdisabled\b/);
    expect(unavailableBlock).not.toMatch(/onClick/);
  });

  it("never imports server-only AI internals directly", () => {
    const aiImports = [...TRIGGER_SOURCE.matchAll(/from\s+"([^"]*@\/lib\/ai[^"]*)"/g)].map((m) => m[1]);
    expect(aiImports).toEqual([]);
  });

  it("never imports provider-factory, MockAiProvider, orchestrate, tools/registry, or request-context anywhere", () => {
    const forbiddenSpecifierFragments = ["provider-factory", "providers/mock", "orchestrate", "tools/registry", "request-context"];
    for (const specifier of [...importSpecifiers(TRIGGER_SOURCE), ...importSpecifiers(PANEL_SOURCE)]) {
      for (const forbidden of forbiddenSpecifierFragments) {
        expect(specifier).not.toContain(forbidden);
      }
    }
  });
});

describe("src/lib/ai/client.ts — source-contract wiring", () => {
  it("posts to the exact fixed endpoint, never a dynamic/templated path", () => {
    expect(CLIENT_SOURCE).toMatch(/const AI_ASSISTANT_ENDPOINT = "\/api\/ai\/assistant";/);
    expect(CLIENT_SOURCE).not.toMatch(/\$\{.*\}.*api\/ai/);
  });

  it("sends Content-Type: application/json and a body of exactly { message }", () => {
    expect(CLIENT_SOURCE).toContain('"Content-Type": "application/json"');
    expect(CLIENT_SOURCE).toMatch(/JSON\.stringify\(\{\s*message\s*\}\)/);
  });

  it("never sends organizationId/userId/history/provider/mockScenario in the request body", () => {
    const bodyLine = CLIENT_SOURCE.match(/body:\s*JSON\.stringify\([^)]*\)/)?.[0] ?? "";
    for (const forbidden of ["organizationId", "userId", "history", "provider", "mockScenario"]) {
      expect(bodyLine).not.toContain(forbidden);
    }
  });

  it("never imports from src/lib/ai/orchestrate, providers/**, tools/**, request-context, or Prisma", () => {
    const forbiddenSpecifierFragments = ["orchestrate", "providers/", "tools/registry", "request-context", "@/lib/prisma", "@/generated/prisma"];
    for (const specifier of importSpecifiers(CLIENT_SOURCE)) {
      for (const forbidden of forbiddenSpecifierFragments) {
        expect(specifier).not.toContain(forbidden);
      }
    }
  });

  it("validates the success response shape at runtime — answer must genuinely be a string", () => {
    expect(CLIENT_SOURCE).toMatch(/typeof\s*\(value as \{ answer: unknown \}\)\.answer === "string"/);
  });
});

describe("staff availability boundary — server/client seam", () => {
  it("(dashboard)/layout.tsx calls the real isAiAssistantAvailable() and passes only a boolean to Header", () => {
    expect(LAYOUT_SOURCE).toMatch(/import\s*\{\s*isAiAssistantAvailable\s*\}\s*from\s*"@\/lib\/ai\/providers\/provider-factory"/);
    expect(LAYOUT_SOURCE).toMatch(/const aiAssistantAvailable = isAiAssistantAvailable\(\);/);
    expect(LAYOUT_SOURCE).toMatch(/aiAssistantAvailable=\{aiAssistantAvailable\}/);
  });

  it("header.tsx's own aiAssistantAvailable prop is typed boolean, and it never IMPORTS or CALLS isAiAssistantAvailable/provider-factory itself (only receives the already-resolved boolean as a prop — a doc comment may still legitimately reference the function's name in prose, explaining where the prop comes from)", () => {
    expect(HEADER_SOURCE).toMatch(/aiAssistantAvailable:\s*boolean/);
    for (const specifier of importSpecifiers(HEADER_SOURCE)) {
      expect(specifier).not.toContain("provider-factory");
    }
    expect(stripComments(HEADER_SOURCE)).not.toMatch(/isAiAssistantAvailable\(\)/); // never actually CALLED here (comment-stripped, so the doc comment's own mention of the function name doesn't false-positive this)
  });

  it("Header mounts AiAssistantTrigger exactly once, passing only the boolean through", () => {
    expect(HEADER_SOURCE).toMatch(/<AiAssistantTrigger available=\{aiAssistantAvailable\} \/>/);
  });
});
