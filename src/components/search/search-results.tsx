"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { SearchResultGroupSection } from "./search-result-group";
import { SearchResultItem } from "./search-result-item";
import { SEARCH_UNAUTHORIZED_MESSAGE, SEARCH_GENERIC_ERROR_MESSAGE } from "@/lib/search-ui/response-mapping";
import { groupFlatResults } from "@/lib/search-ui/flatten-results";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecentSearchResult } from "@/lib/search-ui/recent-searches";
import type { SearchResult } from "@/lib/search/types";
import type { GlobalSearchState } from "./use-global-search";

/**
 * Global Search Slice B (Search Improvement — recent selected results).
 * Rendered only inside the `idle` branch below, when the query is empty/
 * below the minimum length AND at least one recent result exists for the
 * current organization+user — mutually exclusive with every live-search
 * branch, so this and a live results listbox are never both on screen
 * (Slice B spec §19's "do not mix recents + live results"). Reuses
 * SearchResultItem directly (same row visual language, same real-<Link>
 * navigation semantics) with query="" (SearchHighlight/buildHighlightSegments
 * already degrade an empty query to plain, unhighlighted text — there is
 * no "match" to highlight for a recent) and an explicit, distinctly-
 * prefixed id per row so it can never collide with a live option's own
 * `global-search-option-{flatIndex}` id.
 */
function RecentSearchResultsSection({
  recents,
  activeRecentIndex,
  onHover,
  onSelect,
  onClear,
  itemRefs,
}: {
  recents: RecentSearchResult[];
  activeRecentIndex: number;
  onHover: (index: number) => void;
  onSelect: (result: SearchResult) => void;
  onClear: () => void;
  itemRefs: RefObject<Map<number, HTMLAnchorElement | null>>;
}) {
  return (
    <div role="group">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-text-muted text-xs font-semibold tracking-wide uppercase">Recent</p>
        <button
          type="button"
          onClick={onClear}
          className="text-text-muted hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Clear
        </button>
      </div>
      <ul>
        {recents.map((recent, index) => (
          <SearchResultItem
            key={`${recent.type}:${recent.id}`}
            id={`global-search-recent-option-${index}`}
            result={{ ...recent, preview: null }}
            query=""
            isActive={index === activeRecentIndex}
            onHover={() => onHover(index)}
            onSelect={onSelect}
            ref={(el) => {
              itemRefs.current.set(index, el);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Global Search Slice A (Search Improvement — loading skeleton). A
 * fixed, deterministic 3-row placeholder, each row mimicking
 * SearchResultItem's own real shape (a wider title bar, a narrower
 * subtitle bar, the same `px-3 py-2` padding) — no fake leading icon
 * (real rows have none) and no fake per-category group heading (at
 * loading time the real category distribution is unknown, so showing
 * one would misrepresent it). The whole block is `aria-hidden` —
 * decorative only, never in the accessibility tree, never part of
 * `flatResults`/keyboard navigation/`role="option"` — the existing
 * `sr-only role="status" aria-live="polite"` region below is the one
 * accessible loading announcement, unchanged.
 */
function SearchResultsSkeletonRow() {
  return (
    <div className="px-3 py-2">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-1.5 h-3 w-1/3" />
    </div>
  );
}

function SearchResultsSkeleton() {
  return (
    <div data-testid="search-results-skeleton" aria-hidden="true" className="py-1">
      <SearchResultsSkeletonRow />
      <SearchResultsSkeletonRow />
      <SearchResultsSkeletonRow />
    </div>
  );
}

/**
 * Global Search Stage 3 (docs/search-architecture.md §3/§6). Renders every
 * documented state: Initial (idle), Loading, Results (grouped, fixed
 * order), No results, Error, and Rate limited. "Loading" is deliberately
 * NOT a separate branch that blanks the list — `use-global-search.ts`
 * never clears `flatResults` while merely re-fetching (only on an actual
 * settled outcome), so a still-in-flight request naturally keeps the
 * previous result set on screen here; the small spinner that accompanies
 * it lives in search-input.tsx, right next to the field the user is still
 * typing in, not inside this results area. The skeleton below only ever
 * renders for a *fresh* loading state — one with no previous results to
 * keep showing — since the `totalResults > 0` branch above it already
 * wins first and keeps rendering the real (stale-but-valid) result list.
 */
export function SearchResults({
  state,
  listboxId,
  onHover,
  onSelect,
  itemRefs,
  recents,
  activeRecentIndex,
  onRecentHover,
  onClearRecents,
  recentItemRefs,
}: {
  state: GlobalSearchState;
  listboxId: string;
  onHover: (flatIndex: number) => void;
  onSelect: (result: SearchResult) => void;
  itemRefs: RefObject<Map<number, HTMLAnchorElement | null>>;
  /** Global Search Slice B — empty whenever there's nothing to show, or no resolvable organizationId+userId yet (see use-recent-search-results.ts). */
  recents: RecentSearchResult[];
  activeRecentIndex: number;
  onRecentHover: (index: number) => void;
  onClearRecents: () => void;
  recentItemRefs: RefObject<Map<number, HTMLAnchorElement | null>>;
}) {
  const totalResults = state.flatResults.length;
  // Memoized on `state.groups` specifically (not `state` as a whole) so a
  // re-render caused only by `activeIndex` changing (every ArrowUp/
  // ArrowDown keystroke) reuses the same grouped array instead of
  // re-walking the result set on every keystroke.
  const groupedResults = useMemo(() => groupFlatResults(state.groups), [state.groups]);
  let liveMessage = "";
  let body: ReactNode;

  if (state.phase === "idle") {
    // Global Search Slice B — recents only ever render here: `idle` means
    // the query is empty or below the minimum length (use-global-search.ts's
    // own setQuery), the one state Slice B's spec explicitly scopes this
    // to (§22: "below-minimum query still has no live results, so recents
    // remain useful... once query length >= 2, live search state owns the
    // results body"). Deliberately no `liveMessage` here (left "") — a
    // list of previously-opened results is not the outcome of a live
    // search, so it must never be announced as if it reports a match
    // count the way the real `results` branch below does (§20).
    if (recents.length > 0) {
      // Same `id={listboxId} role="listbox"` wrapper the live `results`
      // branch below uses — never both rendered at once, so reusing the
      // id is safe, and SearchInput's own `aria-controls={listboxId}`/
      // `aria-expanded` gate (computed from the same "does a listbox
      // exist" condition in search-dialog.tsx) resolves correctly either
      // way.
      body = (
        <div id={listboxId} role="listbox" aria-label="Recent searches" className="max-h-96 overflow-y-auto py-1">
          <RecentSearchResultsSection
            recents={recents}
            activeRecentIndex={activeRecentIndex}
            onHover={onRecentHover}
            onSelect={onSelect}
            onClear={onClearRecents}
            itemRefs={recentItemRefs}
          />
        </div>
      );
    } else {
      body = (
        <p className="text-text-muted px-3 py-8 text-center text-sm">
          Search clients, projects, tasks, invoices, and comments.
        </p>
      );
    }
  } else if (state.phase === "unauthorized") {
    liveMessage = SEARCH_UNAUTHORIZED_MESSAGE;
    body = <p className="text-text-muted px-3 py-8 text-center text-sm">{SEARCH_UNAUTHORIZED_MESSAGE}</p>;
  } else if (state.phase === "rate_limited") {
    liveMessage = state.message ?? "";
    body = <p className="text-text-muted px-3 py-8 text-center text-sm">{state.message}</p>;
  } else if (state.phase === "error") {
    liveMessage = SEARCH_GENERIC_ERROR_MESSAGE;
    body = <p className="text-text-muted px-3 py-8 text-center text-sm">{SEARCH_GENERIC_ERROR_MESSAGE}</p>;
  } else if (totalResults > 0) {
    // Covers both a settled "results" phase AND "loading" while a fresh
    // query's request is still in flight but the previous result set is
    // still the most recent thing we actually know.
    liveMessage = `${totalResults} result${totalResults === 1 ? "" : "s"}`;
    const sections = groupedResults.map((group) => (
      <SearchResultGroupSection
        key={group.type}
        type={group.type}
        items={group.items}
        query={state.query}
        activeIndex={state.activeIndex}
        onHover={onHover}
        onSelect={onSelect}
        itemRefs={itemRefs}
      />
    ));
    body = (
      <div id={listboxId} role="listbox" aria-label="Search results" className="max-h-96 overflow-y-auto py-1">
        {sections}
      </div>
    );
  } else if (state.phase === "loading") {
    // sr-only announcement text is unchanged ("Searching…") — only the
    // *visible* body changes from plain text to a skeleton.
    liveMessage = "Searching…";
    body = <SearchResultsSkeleton />;
  } else {
    liveMessage = "No results found.";
    body = <p className="text-text-muted px-3 py-8 text-center text-sm">No results found.</p>;
  }

  return (
    <div>
      {body}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </div>
  );
}
