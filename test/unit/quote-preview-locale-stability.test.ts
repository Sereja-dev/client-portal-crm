import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";

/**
 * Forms Improvement Slice B2 hydration correction — the identical
 * implicit-locale mechanism already fixed for Invoice Live Preview V1
 * (see invoice-preview-locale-stability.test.ts's own header comment,
 * and the wider "Stabilize locale-dependent date rendering" precedent
 * this repo already established elsewhere). formatDateOnlyForDisplay()'s
 * own `locale` parameter was already optional before this fix
 * (date-only.ts's own doc comment); the same defect class would recur if
 * QuoteForm's own live-preview call sites ever omitted it, since the
 * server process's own default locale and the visiting browser's default
 * locale can resolve differently, producing a genuine SSR/hydration
 * mismatch (React #418) for the Issue date / Valid until strings.
 *
 * Mirrors invoice-preview-locale-stability.test.ts's own two-part
 * strategy exactly: a source-contract test proving QuoteForm's own call
 * sites pin the locale, plus a behavioral test proving the formatter
 * boundary itself is deterministic when pinned.
 */

describe("QuoteForm — Issue date/Valid until display call sites pin an explicit locale", () => {
  const source = readFileSync("src/components/quotes/quote-form.tsx", "utf-8");

  it("both formatDateOnlyForDisplay(parsed.date, ...) call sites pass an explicit 'en-US' locale", () => {
    const calls = source.match(/formatDateOnlyForDisplay\(parsed\.date[^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatch(/formatDateOnlyForDisplay\(parsed\.date,\s*"en-US"\)/);
    }
  });

  it("never calls formatDateOnlyForDisplay() with a single argument (the environment-implicit default)", () => {
    expect(source).not.toMatch(/formatDateOnlyForDisplay\(parsed\.date\)/);
  });
});

describe("formatDateOnlyForDisplay(date, \"en-US\") — the exact formatter boundary that caused the mismatch", () => {
  it("renders a known date-only value identically to the live-reproduced Production-safe format, regardless of this runtime's own default locale", () => {
    const parsed = parseDateOnly("2026-10-03");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(formatDateOnlyForDisplay(parsed.date, "en-US")).toBe("10/3/2026");
  });

  it("is independent of the caller's own default-locale call — pinning 'en-US' never drifts with the runtime default", () => {
    const parsed = parseDateOnly("2026-10-03");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const enUS = formatDateOnlyForDisplay(parsed.date, "en-US");
    const ruRU = formatDateOnlyForDisplay(parsed.date, "ru-RU");
    expect(enUS).not.toBe(ruRU);
    expect(enUS).toBe("10/3/2026");
    expect(ruRU).toBe("03.10.2026");
  });
});
