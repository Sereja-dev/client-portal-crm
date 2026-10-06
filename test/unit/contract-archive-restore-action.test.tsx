import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ContractArchiveRestoreAction ("use client") imports archiveContractAction/
// restoreContractAction, whose own module graph reaches a "server-only"
// import. That marker throws unless resolved under Next's own
// "react-server" condition — a guard this plain unit test process doesn't
// provide. Neutralizing the marker here doesn't touch the actual archive/
// restore logic at all — same pattern test/unit/delete-conflict-mapper.test.ts
// and test/unit/cron-auth.test.ts already establish for the identical issue.
vi.mock("server-only", () => ({}));

// useRouter() requires a real Next.js app-router context this plain
// renderToStaticMarkup call never provides ("invariant expected app
// router to be mounted") — this component's own router.refresh() call
// is never reached by a closed-state static render anyway (it only
// fires from inside the ConfirmDialog's onConfirm callback), so a
// minimal stub is enough to exercise the actual render output below.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// Same reasoning as the router mock above: useToast() throws outside a
// real <ToastProvider>, which this closed-state static render never
// mounts (and never needs to — showToast is only ever called from
// inside the ConfirmDialog's own onConfirm callback, never during the
// initial render this test exercises).
vi.mock("@/components/toast/toast-provider", () => ({ useToast: () => ({ showToast: () => {} }) }));

const { ContractArchiveRestoreAction } = await import("@/components/contracts/contract-archive-restore-action");

/**
 * Tables Improvement Slice B — real-render coverage for the narrow
 * Contract-list-row Archive/Restore wrapper, mirroring
 * test/unit/row-action-menu.test.tsx's own `renderToStaticMarkup`
 * precedent (no jsdom/@testing-library/react exists in this repo).
 * `ConfirmDialog`'s own `<dialog>` is always present in the markup
 * (gated by native `showModal()`, never a conditional React render), so
 * its title/description text is directly assertable even in this
 * closed-state static render.
 */
describe("ContractArchiveRestoreAction — real render", () => {
  it("an active (not archived) Contract renders an 'Archive' trigger and the existing Archive confirmation copy", () => {
    const html = renderToStaticMarkup(<ContractArchiveRestoreAction contractId="c1" isArchived={false} />);
    expect(html).toMatch(/<button[^>]*>Archive<\/button>/);
    expect(html).not.toContain(">Restore<");
    expect(html).toContain("Archive contract");
    expect(html).toContain("This contract will be hidden from the active list");
  });

  it("an archived Contract renders a 'Restore' trigger and the existing Restore confirmation copy", () => {
    const html = renderToStaticMarkup(<ContractArchiveRestoreAction contractId="c1" isArchived={true} />);
    expect(html).toMatch(/<button[^>]*>Restore<\/button>/);
    expect(html).not.toContain(">Archive<");
    expect(html).toContain("Restore contract");
    expect(html).toContain("This contract will reappear in the active list");
  });

  it("never renders both Archive and Restore trigger text at once for the same instance", () => {
    const activeHtml = renderToStaticMarkup(<ContractArchiveRestoreAction contractId="c1" isArchived={false} />);
    const archivedHtml = renderToStaticMarkup(<ContractArchiveRestoreAction contractId="c1" isArchived={true} />);
    expect(activeHtml).not.toEqual(archivedHtml);
  });
});
