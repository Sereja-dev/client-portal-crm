"use client";

import { useEffect, useRef } from "react";
import { SearchIcon } from "@/components/ui/icons";
import { SearchDialog, type SearchDialogHandle } from "./search-dialog";
import { isSearchShortcut, shouldHandleSearchShortcut, type EditableTargetLike } from "@/lib/search-ui/shortcut";

/**
 * Global Search Stage 3 (docs/search-architecture.md §3, "Entry points").
 * The one mounted instance of the whole feature: a Header trigger button
 * plus the single global `Cmd+K`/`Ctrl+K` keydown listener docs/search-
 * architecture.md calls for — mounted here (inside the Header, which is
 * itself only ever rendered by `(dashboard)/layout.tsx`, never the portal
 * layout) rather than as a second, separately-mounted component alongside
 * `Sidebar`, since the trigger button and the shortcut both need to act on
 * the exact same dialog instance/handle.
 *
 * A staff-only surface by construction: this component (and therefore the
 * shortcut listener) simply never exists in the React tree the Client
 * Portal renders — there is no flag or runtime check to bypass, the same
 * structural guarantee Comments & Mentions relied on for its own portal
 * exclusion.
 */
export function GlobalSearch({
  organizationId,
  userId,
}: {
  /** Global Search Slice B — passed straight through from header.tsx's own already-resolved identity; never fetched here. See search-dialog.tsx's own header comment. */
  organizationId: string | null;
  userId: string | null;
}) {
  const dialogHandleRef = useRef<SearchDialogHandle>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event)) return;

      const dialogIsOpen = dialogHandleRef.current?.isOpen() ?? false;
      if (!shouldHandleSearchShortcut(event.target as EditableTargetLike, dialogIsOpen)) {
        return;
      }

      // Stops the browser's own address-bar-focus shortcut from firing
      // alongside ours.
      event.preventDefault();

      if (dialogIsOpen) {
        dialogHandleRef.current?.close();
      } else {
        dialogHandleRef.current?.open();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Search (Cmd+K)"
        onClick={() => dialogHandleRef.current?.open()}
        className="border-border-strong text-text-secondary focus-visible:ring-focus-ring flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="border-border-default bg-surface-muted text-text-muted hidden shrink-0 rounded border px-1.5 py-0.5 font-sans text-xs sm:inline">
          ⌘K
        </kbd>
      </button>
      <SearchDialog ref={dialogHandleRef} organizationId={organizationId} userId={userId} />
    </>
  );
}
