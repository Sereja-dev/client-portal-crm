import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Same reasoning as test/unit/contract-archive-restore-action.test.tsx's
// own identical mock: useToast() throws outside a real <ToastProvider>,
// which this closed-state static render never mounts and never needs —
// showToast is only ever called from inside an event handler (Save/
// Rename/Delete submit), never during the initial render this file
// exercises.
vi.mock("@/components/toast/toast-provider", () => ({ useToast: () => ({ showToast: () => {} }) }));

const { SavedViewsControl } = await import("@/components/list/saved-views-control");

/**
 * Tables Improvement Slice D1 — real-render coverage for the shared
 * Saved Views UI, within the same `renderToStaticMarkup`-only limitation
 * this repo's own RowActionMenu/useBoundedSelection unit tests already
 * document (no jsdom/@testing-library/react harness exists here, so no
 * event can actually be dispatched and no re-render observed).
 *
 * `useSavedViews` is built on `useSyncExternalStore`, whose
 * `getServerSnapshot` (always an empty list — see that hook's own
 * header comment) is unconditionally what React uses whenever there is
 * no `window` global, which is exactly this Node-environment unit test
 * process (vitest.config.ts's own `environment: "node"`). That means
 * EVERY render in this file is the "no saved views yet" state — which
 * is also the real, guaranteed-correct state of every actual browser's
 * FIRST paint before hydration (the same hydration-safety property this
 * whole hook exists to provide). The real populated-list, Save, Apply,
 * Rename, and Delete interactions are proven in a real browser instead
 * — see test/e2e/invoice-saved-views.spec.ts and
 * test/e2e/contract-saved-views.spec.ts.
 */
describe("SavedViewsControl — real render, empty state", () => {
  const baseProps = {
    organizationId: "org-1",
    userId: "user-1",
    surface: "invoices" as const,
    currentParams: { q: "acme" },
    buildApplyHref: (params: Record<string, string>) => `/invoices?${new URLSearchParams(params).toString()}`,
  };

  it("renders an accessible group named 'Saved views'", () => {
    const html = renderToStaticMarkup(<SavedViewsControl {...baseProps} />);
    expect(html).toMatch(/role="group"/);
    expect(html).toMatch(/aria-label="Saved views"/);
  });

  it("with no saved views yet, shows 'Save current view' and nothing else -- no scary empty-state copy, no select/Apply/Rename, and no reachable Delete trigger", () => {
    const html = renderToStaticMarkup(<SavedViewsControl {...baseProps} />);
    expect(html).toContain("Save current view");
    expect(html).not.toContain(">Apply<");
    expect(html).not.toContain(">Rename<");
    expect(html).not.toMatch(/<select/);
    // ConfirmDialog's own <dialog> (gated by native showModal(), never a
    // conditional React render -- see contract-archive-restore-action.
    // test.tsx's own identical precedent) is always present in the
    // markup, so its own "Delete" confirm button always appears once;
    // what must be ABSENT in the empty state is the per-view Delete
    // TRIGGER button that opens it (disabled={!selectedView}, but still
    // rendered) -- which only exists inside the `views.length > 0`
    // branch at all.
    expect([...html.matchAll(/>Delete</g)]).toHaveLength(1);
    expect(html).toContain("Delete saved view");
    // No alarming/error copy of any kind in the empty state.
    expect(html.toLowerCase()).not.toMatch(/error|failed|unavailable/);
  });

  it("never throws regardless of which surface or currentParams shape it's given", () => {
    expect(() =>
      renderToStaticMarkup(
        <SavedViewsControl
          organizationId="org-1"
          userId="user-1"
          surface="contracts"
          currentParams={{ q: "", status: "DRAFT", client: "00000000-0000-0000-0000-000000000000", archived: "1" }}
          buildApplyHref={() => "/contracts"}
        />,
      ),
    ).not.toThrow();
  });

  it("renders identically regardless of the specific currentParams values -- Save form visibility doesn't depend on them at initial render", () => {
    const htmlA = renderToStaticMarkup(<SavedViewsControl {...baseProps} currentParams={{}} />);
    const htmlB = renderToStaticMarkup(<SavedViewsControl {...baseProps} currentParams={{ q: "something-else", status: "PAID" }} />);
    expect(htmlA).toBe(htmlB);
  });
});
