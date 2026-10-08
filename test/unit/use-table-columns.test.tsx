import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useTableColumns } from "@/components/list/use-table-columns";
import { normalizeHiddenColumnIds } from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E1 — real-render coverage for the shared
 * Column Customization hook's own INITIAL/derived state only, same
 * scope and same `renderToStaticMarkup` one-shot technique
 * `use-bounded-selection.test.tsx` already establishes for this exact
 * reason (see that file's own header comment): this repo has no jsdom/
 * @testing-library/react harness to drive a real toggle/reset
 * interaction and observe the resulting re-render. A one-shot render
 * exercises `useSyncExternalStore`'s `getServerSnapshot` path (no real
 * `window`/mount lifecycle here either), which is exactly the "every
 * column visible" default this hook's own header comment documents as
 * the hydration-safe SSR value — the one thing most worth proving with
 * a static render. The hook's real interactive behavior (toggle/reset
 * actually mutating state and persisting) is proven in a real browser
 * by test/e2e/invoice-column-customization.spec.ts; the underlying
 * normalization rules a toggle/reset ultimately relies on are already
 * exhaustively covered as pure functions in
 * table-columns-storage.test.ts and re-exercised directly below.
 */

const KNOWN = ["invoiceNumber", "project", "client", "amount", "status", "dueDate", "createdAt", "actions"] as const;
const MANDATORY = ["invoiceNumber", "status", "actions"] as const;

function Probe({ organizationId, userId }: { organizationId: string; userId: string }) {
  const { hiddenIds, isVisible } = useTableColumns(organizationId, userId, "invoices", KNOWN, MANDATORY);
  return (
    <output
      data-hidden-count={hiddenIds.length}
      data-project-visible={isVisible("project")}
      data-invoice-number-visible={isVisible("invoiceNumber")}
      data-status-visible={isVisible("status")}
      data-actions-visible={isVisible("actions")}
    />
  );
}

describe("useTableColumns — initial (server-snapshot) derived state", () => {
  it("every column is visible by default -- no stored preference, no localStorage/window available during a static render", () => {
    const html = renderToStaticMarkup(<Probe organizationId="org-1" userId="user-1" />);
    expect(html).toContain('data-hidden-count="0"');
    expect(html).toContain('data-project-visible="true"');
    expect(html).toContain('data-invoice-number-visible="true"');
    expect(html).toContain('data-status-visible="true"');
    expect(html).toContain('data-actions-visible="true"');
  });

  it("renders identically for a different organizationId/userId -- the default (no stored preference) is never identity-dependent", () => {
    const htmlA = renderToStaticMarkup(<Probe organizationId="org-a" userId="user-a" />);
    const htmlB = renderToStaticMarkup(<Probe organizationId="org-b" userId="user-b" />);
    expect(htmlA).toBe(htmlB);
  });
});

/**
 * The visibility rules a real toggle/reset ultimately produce --
 * exercised here directly against the same pure `normalizeHiddenColumnIds`
 * the hook itself calls on every read and write, covering exactly the
 * scenarios locked spec §23 asks for (hide one/multiple optional,
 * mandatory stays visible, unknown id ignored, de-duplicated, reset
 * returns all visible).
 */
describe("column visibility rules (via normalizeHiddenColumnIds, the hook's own normalization step)", () => {
  function visibleIds(hidden: string[]): string[] {
    const normalized = new Set(normalizeHiddenColumnIds(hidden, KNOWN, MANDATORY));
    return KNOWN.filter((id) => !normalized.has(id));
  }

  it("all columns visible by default (empty hiddenIds)", () => {
    expect(visibleIds([])).toEqual([...KNOWN]);
  });

  it("hide one optional column", () => {
    expect(visibleIds(["project"])).toEqual(KNOWN.filter((id) => id !== "project"));
  });

  it("hide multiple optional columns", () => {
    expect(visibleIds(["project", "amount", "createdAt"])).toEqual(
      KNOWN.filter((id) => !["project", "amount", "createdAt"].includes(id)),
    );
  });

  it("mandatory columns (invoiceNumber, status, actions) remain visible even if present in hiddenIds", () => {
    expect(visibleIds(["invoiceNumber", "status", "actions"])).toEqual([...KNOWN]);
  });

  it("actions specifically remains visible under any hidden-ids input", () => {
    expect(visibleIds(["actions", "project", "client"])).toContain("actions");
  });

  it("an unknown hidden id is ignored -- never hides an unrelated real column", () => {
    expect(visibleIds(["notARealColumn"])).toEqual([...KNOWN]);
  });

  it("normalization de-duplicates before computing visibility", () => {
    expect(visibleIds(["project", "project"])).toEqual(KNOWN.filter((id) => id !== "project"));
  });

  it("reset (empty hiddenIds) returns every column visible, including after a previously-hidden state", () => {
    expect(visibleIds(["project", "amount"])).not.toEqual([...KNOWN]);
    expect(visibleIds([])).toEqual([...KNOWN]);
  });
});
