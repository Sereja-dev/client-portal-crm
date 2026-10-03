import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";

/**
 * Invoice Live Preview V1 hydration correction — the identical
 * implicit-locale mechanism already fixed elsewhere in this repo (see
 * "Stabilize locale-dependent date rendering": relativeTime(),
 * SlackConnectionCard, CommentItem, NotificationListItem,
 * TimelineNoteItem, InvoiceSendControls — all pinned to an explicit
 * "en-US", matching this repo's existing REFERENCE_LOCALE/PDF_LOCALE
 * precedent). formatDateOnlyForDisplay()'s own `locale` parameter was
 * already optional before this fix (date-only.ts's own doc comment); the
 * defect was InvoiceForm's two live-preview call sites never passing it,
 * so the server process's own default locale (confirmed ru-RU in this
 * sandbox) and the visiting browser's default locale (confirmed en-US
 * under Playwright's Chromium) produced two different rendered strings
 * for the exact same Issue/Due date — a genuine SSR/hydration mismatch
 * (React #418), live-reproduced on /invoices/new.
 *
 * Mirrors this repo's own established two-part strategy for this exact
 * defect class: a source-contract test (see
 * locale-stable-timestamp-titles.test.ts) proving the call sites pin the
 * locale, plus a behavioral test (see relative-time-locale.test.ts)
 * proving the formatter/adapter boundary itself is deterministic —
 * tested directly against formatDateOnlyForDisplay(), never a brittle
 * full-DOM/rendered-component snapshot.
 */

describe("InvoiceForm — Issue/Due date display call sites pin an explicit locale", () => {
  const source = readFileSync("src/components/invoices/invoice-form.tsx", "utf-8");

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

  it("is independent of the caller's own default-locale call — pinning 'en-US' never drifts with the runtime default, unlike the pre-fix call site", () => {
    const parsed = parseDateOnly("2026-10-03");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Sanity check: this runtime's own Intl implementation genuinely does
    // differentiate locales for this format — otherwise this whole bug
    // class (and this regression test) would be moot in this environment.
    const enUS = formatDateOnlyForDisplay(parsed.date, "en-US");
    const ruRU = formatDateOnlyForDisplay(parsed.date, "ru-RU");
    expect(enUS).not.toBe(ruRU);

    // The exact Production mismatch this fix closes: server (ru-RU) used
    // to render "03.10.2026" while the browser (en-US) hydrated expecting
    // "10/3/2026". Pinning the call site to "en-US" means both the server
    // and every client now always produce this exact string.
    expect(enUS).toBe("10/3/2026");
    expect(ruRU).toBe("03.10.2026");
  });

  it("the caller's own default (no locale argument) still resolves to the runtime's own default — proving the fix is in the call site, not a behavior change to the helper itself", () => {
    const parsed = parseDateOnly("2026-10-03");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // date-only.ts's own existing contract: locale is optional, and an
    // omitted locale still falls through to the runtime default — this
    // fix pins the call site, it does not change formatDateOnlyForDisplay()'s
    // own default behavior (in scope: existing server-only callers like
    // invoice-read-only-view.tsx and pdf/view-model.ts, which already
    // either run exclusively server-side or already pass their own
    // locale, must keep behaving exactly as before).
    expect(formatDateOnlyForDisplay(parsed.date)).toBe(formatDateOnlyForDisplay(parsed.date, undefined));
  });
});
