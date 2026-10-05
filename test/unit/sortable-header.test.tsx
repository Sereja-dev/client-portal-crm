import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SortableHeader } from "@/components/ui/sortable-header";

/**
 * Tables Improvement Slice A — real-render coverage for the shared
 * clickable sortable desktop header, mirroring record-list.test.tsx's
 * own `renderToStaticMarkup` precedent. This primitive is deliberately
 * "dumb" (see its own header comment) — it never knows what a field
 * name means and never builds a Prisma `orderBy` — so these tests cover
 * exactly what it IS responsible for: `aria-sort`, the visual direction
 * indicator, and rendering the caller-supplied href verbatim. Domain-
 * specific defaults/toggle logic (Invoice's own
 * nextInvoiceSortCombined) are covered separately in
 * test/unit/invoices-sort-helpers.test.ts, per this primitive's own
 * "domain-independent logic here, domain defaults in Invoice
 * configuration" split.
 */
function renderInTable(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <table>
      <thead>
        <tr>{node}</tr>
      </thead>
    </table>,
  );
}

describe("SortableHeader — real render", () => {
  it("unsorted (not the current key): aria-sort=\"none\", neutral indicator, 'not sorted' sr-only text — never falsely claims a direction", () => {
    const html = renderInTable(<SortableHeader label="Amount" href="/invoices?sort=amount:desc" direction={null} />);
    expect(html).toMatch(/<th[^>]*aria-sort="none"[^>]*>/);
    expect(html).toContain("⇅");
    expect(html).toContain(", not sorted");
    expect(html).not.toContain(", sorted ascending");
    expect(html).not.toContain(", sorted descending");
  });

  it("ascending current state: aria-sort=\"ascending\", ▲ indicator, 'sorted ascending' sr-only text", () => {
    const html = renderInTable(<SortableHeader label="Due date" href="/invoices?sort=dueDate:desc" direction="asc" />);
    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*>/);
    expect(html).toContain("▲");
    expect(html).toContain(", sorted ascending");
  });

  it("descending current state: aria-sort=\"descending\", ▼ indicator, 'sorted descending' sr-only text", () => {
    const html = renderInTable(<SortableHeader label="Created" href="/invoices?sort=createdAt:asc" direction="desc" />);
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>/);
    expect(html).toContain("▼");
    expect(html).toContain(", sorted descending");
  });

  it("renders the caller-supplied href verbatim — this primitive never builds or mutates it", () => {
    const html = renderInTable(
      <SortableHeader label="Amount" href="/invoices?status=SENT&amp;sort=amount:asc" direction="desc" />,
    );
    expect(html).toContain('href="/invoices?status=SENT&amp;sort=amount:asc"');
  });

  it("preserves real <th scope=\"col\"> semantics (delegates to TableHeaderCell)", () => {
    const html = renderInTable(<SortableHeader label="Amount" href="/invoices?sort=amount:desc" direction={null} />);
    expect(html).toMatch(/<th[^>]*scope="col"[^>]*>/);
  });

  it("the label text itself is present as real, visible text", () => {
    const html = renderInTable(<SortableHeader label="Due date" href="/invoices?sort=dueDate:asc" direction={null} />);
    expect(html).toContain("Due date");
  });
});
