import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuickFilterChips } from "@/components/list/quick-filter-chips";

/**
 * Tables Improvement Slice A — real-render coverage for the shared
 * quick-filter chip row, extracted from Tasks' own already-proven
 * `QuickFilterChip`. No internal state of any kind — every chip is a
 * plain, already-built `{label, href, active}` the caller computes from
 * the SAME canonical URL state its own `SearchFilterBar` dropdown reads
 * (see invoices/query.ts's own INVOICE_QUICK_FILTERS + the page's own
 * href-building, covered separately in
 * test/unit/invoices-sort-helpers.test.ts).
 */
describe("QuickFilterChips — real render", () => {
  it("renders every chip as a real <a href> with its own label text", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        label="Invoice quick filters"
        chips={[
          { label: "Draft", href: "/invoices?status=DRAFT", active: false },
          { label: "Sent", href: "/invoices?status=SENT", active: false },
        ]}
      />,
    );
    expect(html).toContain('href="/invoices?status=DRAFT"');
    expect(html).toContain("Draft");
    expect(html).toContain('href="/invoices?status=SENT"');
    expect(html).toContain("Sent");
  });

  it("an active chip exposes aria-current=\"true\"; an inactive chip omits aria-current entirely", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        label="Invoice quick filters"
        chips={[
          { label: "Draft", href: "/invoices?status=DRAFT", active: true },
          { label: "Sent", href: "/invoices", active: false },
        ]}
      />,
    );
    expect(html).toMatch(/aria-current="true"/);
    // Exactly one aria-current in the whole markup — the inactive chip
    // never gets a competing aria-current="false" (omitted, not falsy).
    expect([...html.matchAll(/aria-current/g)]).toHaveLength(1);
  });

  it("the active chip's own href is distinguishable from the inactive chip's by styling class, not just the aria attribute (bg-accent vs bg-surface-recessed)", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        label="Invoice quick filters"
        chips={[
          { label: "Draft", href: "/invoices?status=DRAFT", active: true },
          { label: "Sent", href: "/invoices", active: false },
        ]}
      />,
    );
    const draftMatch = html.match(/<a[^>]*href="\/invoices\?status=DRAFT"[^>]*>/)![0];
    const sentMatch = html.match(/<a[^>]*href="\/invoices"[^>]*>/)![0];
    expect(draftMatch).toContain("bg-accent");
    expect(sentMatch).toContain("bg-surface-recessed");
  });

  it("wraps every chip in a role=\"group\" with the caller-supplied accessible name", () => {
    const html = renderToStaticMarkup(<QuickFilterChips label="Invoice quick filters" chips={[]} />);
    expect(html).toMatch(/role="group"/);
    expect(html).toMatch(/aria-label="Invoice quick filters"/);
  });

  it("renders zero chips (an empty group) without throwing when given an empty list", () => {
    const html = renderToStaticMarkup(<QuickFilterChips label="Invoice quick filters" chips={[]} />);
    expect(html).not.toContain("<a ");
  });
});
