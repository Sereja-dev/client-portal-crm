"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { SearchResultGroupSection } from "./search-result-group";
import { SEARCH_UNAUTHORIZED_MESSAGE, SEARCH_GENERIC_ERROR_MESSAGE } from "@/lib/search-ui/response-mapping";
import { groupFlatResults } from "@/lib/search-ui/flatten-results";
import { Skeleton } from "@/components/ui/skeleton";
import type { GlobalSearchState } from "./use-global-search";

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
}: {
  state: GlobalSearchState;
  listboxId: string;
  onHover: (flatIndex: number) => void;
  onSelect: () => void;
  itemRefs: RefObject<Map<number, HTMLAnchorElement | null>>;
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
    body = (
      <p className="text-text-muted px-3 py-8 text-center text-sm">
        Search clients, projects, tasks, invoices, and comments.
      </p>
    );
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
