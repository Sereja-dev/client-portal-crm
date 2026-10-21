import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiAssistantTrigger } from "@/components/ai/ai-assistant-trigger";

/**
 * AI Assistant staff drawer/UI batch — genuine behavior-level render
 * coverage for the Header trigger, matching this repo's own established
 * `renderToStaticMarkup` precedent (no DOM/component-interaction harness
 * — see test/unit/segment-error-state.test.tsx's own header comment).
 * This actually executes the real component through React's render
 * pipeline; its one real limitation (no event handlers in static markup)
 * is covered instead by the companion source-contract test and the E2E
 * suite (test/e2e/ai-assistant-drawer.spec.ts).
 *
 * Unfinished Features Cleanup (Block 17) — the `available=false` branch
 * previously rendered a permanently-disabled "AI Assistant (coming
 * soon)" button; Product decided that's exactly the kind of
 * unfinished-looking surface this block exists to eliminate, so this
 * branch now renders nothing at all. The `available=true` describe
 * block below is unchanged from before this slice — the real, working
 * feature's own coverage is not weakened.
 */

describe("AiAssistantTrigger — available=false (Production, no provider yet)", () => {
  const html = renderToStaticMarkup(<AiAssistantTrigger available={false} />);

  it("renders nothing at all — no disabled button, no affordance of any kind", () => {
    expect(html).toBe("");
  });

  it("never mentions 'coming soon' — the old disabled placeholder is gone entirely, not merely hidden", () => {
    expect(html.toLowerCase()).not.toContain("coming soon");
  });

  it("never renders the panel/dialog at all when unavailable", () => {
    expect(html).not.toContain("<dialog");
  });
});

describe("AiAssistantTrigger — available=true", () => {
  const html = renderToStaticMarkup(<AiAssistantTrigger available={true} />);

  it("renders an enabled trigger button (the panel's own initially-empty submit button is separately, legitimately disabled — this asserts only the trigger itself)", () => {
    const triggerButtonMatch = html.match(/<button[^>]*aria-label="AI Assistant"[^>]*>/);
    expect(triggerButtonMatch).not.toBeNull();
    expect(triggerButtonMatch![0]).not.toMatch(/\bdisabled=""/);
  });

  it("has a clear, unambiguous accessible label — never mentioning Search", () => {
    expect(html).toContain('aria-label="AI Assistant"');
    expect(html.toLowerCase()).not.toContain("search");
  });

  it("mounts the panel (dialog) alongside the trigger", () => {
    expect(html).toContain("<dialog");
  });

  it("visible label text says AI Assistant, distinct from the Search trigger's own 'Search…' label", () => {
    expect(html).toContain("AI Assistant");
    expect(html).not.toContain("Search…");
  });
});
