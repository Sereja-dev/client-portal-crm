"use client";

import { useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";
import { useGlobalSearch } from "./use-global-search";
import { useRecentSearchResults } from "./use-recent-search-results";
import { nextActiveIndex } from "@/lib/search-ui/flatten-results";
import { SEARCH_QUERY_MIN_LENGTH } from "@/lib/search/normalize-query";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import type { SearchResult } from "@/lib/search/types";

export type SearchDialogHandle = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

/**
 * Global Search Stage 3 (docs/search-architecture.md §3, "The dialog").
 * A native `<dialog>` — matching `ConfirmDialog` exactly: free focus trap,
 * free Escape-to-close, free backdrop-click-to-close, and free return-
 * focus-to-invoker on close (the HTML spec has `showModal()` remember
 * whatever element was focused beforehand and refocus it once the dialog
 * closes — no manual ref-passing needed for that part).
 *
 * `useGlobalSearch`'s state is reset on every close (`onClose`, the native
 * `close` DOM event React exposes for `<dialog>`) — whether the user
 * pressed Escape, clicked the backdrop, or selected a result — so a
 * re-opened dialog always starts from the neutral empty state, never a
 * stale query or stale result set from whatever was last searched.
 *
 * A switch to a different organization is handled independently of that:
 * `<dialog>` is modal (`showModal()`), which makes the rest of the document
 * — including the organization switcher — inert while this is open, so an
 * org switch cannot even begin mid-search. As defense-in-depth against that
 * assumption ever changing, header.tsx also mounts `<GlobalSearch
 * key={activeOrganizationId}>` — React fully unmounts and remounts this
 * whole subtree (discarding all `useGlobalSearch` state, and — Global
 * Search Slice B — all recents UI state) whenever the active organization
 * id changes, independent of whether the dialog happened to be open at the
 * time.
 *
 * Global Search Slice B (Search Improvement — recent selected results).
 * `organizationId`/`userId` are passed down from the one existing server
 * boundary that already resolves both at zero extra query cost
 * ((dashboard)/layout.tsx's own getCurrentMembership() call — see
 * header.tsx) — never fetched here, never read from localStorage/session.
 * Recents are an entirely separate, parallel "active option" state
 * (`activeRecentIndex`/`recentItemRefs`) from the live search's own
 * `state.activeIndex`/`itemRefs` — the two are never merged into one
 * flattened list, and are never both rendered at the same time (recents
 * only ever show in the live search's own `idle` phase — see
 * search-results.tsx), so there is never a question of which one "wins."
 */
export function SearchDialog({
  ref,
  organizationId,
  userId,
}: {
  ref?: Ref<SearchDialogHandle>;
  organizationId: string | null;
  userId: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLAnchorElement | null>>(new Map());
  const recentItemRefs = useRef<Map<number, HTMLAnchorElement | null>>(new Map());
  const titleId = useId();
  const listboxId = useId();

  const { state, setQuery, reset, moveActive, setActiveByHover } = useGlobalSearch();
  const recentsApi = useRecentSearchResults(organizationId, userId);
  const [activeRecentIndex, setActiveRecentIndex] = useState(-1);

  // Recents only ever render while the live search is in its own `idle`
  // phase (empty/below-minimum query — see search-results.tsx's own
  // identical condition) and at least one actually exists.
  const showingRecents = state.phase === "idle" && recentsApi.recents.length > 0;

  // Global Search Slice B — `activeRecentIndex` is kept correct across
  // every transition the spec calls out (§19) by updating it directly,
  // synchronously, inside the real event handler that causes each
  // transition — never inside a useEffect reacting to a derived value
  // (the same "route a state transition through a real event instead of
  // an effect body" discipline use-global-search.ts's own setQuery
  // already documents and this codebase's lint rules enforce).
  //   - handleQueryChange below: crossing the idle<->active boundary
  //     while typing/deleting.
  //   - open() below: (re-)entering idle-with-recents when the dialog opens.
  //   - handleClearRecents below: Clear empties the list while idle.

  function handleQueryChange(value: string) {
    setQuery(value);
    const willBeIdle = value.trim().length < SEARCH_QUERY_MIN_LENGTH;
    if (willBeIdle) {
      // Re-entering idle (including the very first keystroke on a fresh
      // dialog) auto-highlights the first recent, mirroring live search's
      // own "auto-highlight the first result" convention.
      setActiveRecentIndex(recentsApi.recents.length > 0 ? 0 : -1);
    } else {
      // Leaving idle for a real query: live flatResults own the active
      // index from here; no recent row stays "active" underneath it.
      setActiveRecentIndex(-1);
    }
  }

  function handleClearRecents() {
    recentsApi.clear();
    setActiveRecentIndex(-1);
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      // Re-reads from storage every open (not merely once at mount) —
      // picks up a selection made the last time this same dialog was
      // used, without depending on a full page reload (spec §23).
      const fresh = recentsApi.refresh();
      setActiveRecentIndex(fresh.length > 0 ? 0 : -1);
      dialogRef.current?.showModal();
      // showModal() itself doesn't move focus into the dialog's own
      // content on every browser — explicitly focusing the input matches
      // docs/search-architecture.md §3's "autofocused on open" and is
      // harmless where the browser already did it.
      inputRef.current?.focus();
    },
    close: () => dialogRef.current?.close(),
    isOpen: () => dialogRef.current?.open ?? false,
  }));

  function selectActiveResult() {
    const el = itemRefs.current.get(state.activeIndex);
    // Simulates a genuine click on the real <Link>-rendered <a> (see
    // search-result-item.tsx) — reuses that exact same navigation path
    // (including Next's own hash-fragment scroll handling for a Comment's
    // #comment-{id} deep link) rather than a second, hand-rolled
    // `router.push` call.
    el?.click();
  }

  /** Global Search Slice B — the recents equivalent of selectActiveResult() above, same simulated-click mechanism, same reasoning. */
  function selectActiveRecent() {
    const el = recentItemRefs.current.get(activeRecentIndex);
    el?.click();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (showingRecents) {
      // Global Search Slice B — while recents own the results area,
      // Arrow/Enter navigate *them*, never the (empty, in this phase)
      // live flatResults. Escape is still left unhandled below, same
      // reasoning as the live-search branch.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveRecentIndex((current) => nextActiveIndex(current, recentsApi.recents.length, 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveRecentIndex((current) => nextActiveIndex(current, recentsApi.recents.length, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeRecentIndex >= 0) {
          selectActiveRecent();
        }
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (state.activeIndex >= 0) {
        selectActiveResult();
      }
    }
    // Escape is deliberately never handled here — it must reach the
    // native <dialog>'s own cancel/close handling unimpeded.
  }

  /**
   * Global Search Slice B — the one shared selection path (spec §29):
   * fires identically whether the user picked a live result or re-picked
   * an already-recent one (addRecentSearchResult's own dedupe-by-type+id
   * already handles "move back to front" as the same operation as "add
   * new" — no special-casing needed here). Only the minimal, already-
   * display-safe fields are copied across — `result.preview` (a Comment's
   * body snippet) is never read here, so it can never reach storage
   * (spec §7/§43). Recording is synchronous, best-effort local storage
   * (use-recent-search-results.ts never throws into this component), so
   * it can never block or delay the navigation that follows.
   */
  function handleResultSelected(result: SearchResult) {
    recentsApi.record({
      type: result.type,
      id: result.id,
      title: result.title,
      subtitle: result.subtitle,
      url: result.url,
    });
    // Deferred a tick, same reasoning as NotificationBell's own close():
    // the click that just fired is the <Link>'s own navigation-triggering
    // click, still bubbling through this same DOM tree — closing (and
    // thereby resetting the live search state) synchronously in that same
    // tick risks racing Next's own navigation start. Letting it finish
    // first, then closing, avoids that race entirely.
    setTimeout(() => dialogRef.current?.close(), 0);
  }

  const activeResult = state.flatResults[state.activeIndex];
  // Global Search Slice B — exactly one of these two can ever be true at
  // once (showingRecents requires phase === "idle"; a non-empty
  // flatResults requires a settled/loading-with-cache live phase, never
  // "idle"), so there is never an ambiguous "which one is the real active
  // descendant" question.
  const hasListbox = showingRecents || state.flatResults.length > 0;
  const activeDescendantId = showingRecents
    ? activeRecentIndex >= 0
      ? `global-search-recent-option-${activeRecentIndex}`
      : undefined
    : activeResult
      ? `global-search-option-${activeResult.flatIndex}`
      : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={reset}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      // backdrop:bg-black/40 deliberately kept literal — the same
      // theme-invariant modal scrim ConfirmDialog's own <dialog> already
      // uses, not a grep hit to eliminate for its own sake.
      className={`w-full max-w-lg p-0 shadow-xl backdrop:bg-black/40 ${CARD_SURFACE_CLASSES} ${DIALOG_CENTER_CLASSES}`}
    >
      <h2 id={titleId} className="sr-only">
        Search
      </h2>
      <SearchInput
        inputRef={inputRef}
        value={state.query}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        isLoading={state.phase === "loading"}
        listboxId={listboxId}
        hasListbox={hasListbox}
        activeDescendantId={activeDescendantId}
      />
      <SearchResults
        state={state}
        listboxId={listboxId}
        onHover={setActiveByHover}
        onSelect={handleResultSelected}
        itemRefs={itemRefs}
        recents={recentsApi.recents}
        activeRecentIndex={activeRecentIndex}
        onRecentHover={setActiveRecentIndex}
        onClearRecents={handleClearRecents}
        recentItemRefs={recentItemRefs}
      />
    </dialog>
  );
}
