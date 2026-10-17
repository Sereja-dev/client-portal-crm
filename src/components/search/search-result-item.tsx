"use client";

import Link from "next/link";
import type { Ref } from "react";
import { SearchHighlight } from "./search-highlight";
import type { SearchResult } from "@/lib/search/types";

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  CLIENT: "Client",
  PROJECT: "Project",
  TASK: "Task",
  INVOICE: "Invoice",
  COMMENT: "Comment",
};

/**
 * Global Search Stage 3 (docs/search-architecture.md §7/§10). One result
 * row — deliberately a real `<Link>` (not a plain `<div onClick>`), the
 * same "an actual navigable anchor, not a fake one" discipline
 * `NotificationItem` already established: middle-click/right-click/
 * open-in-new-tab all keep working, and reusing `<Link>` reuses Next's own
 * already-proven-correct hash-fragment scroll behavior for a Comment's
 * `#comment-{id}` deep link, rather than a second, hand-rolled navigation
 * path.
 *
 * `tabIndex={-1}` deliberately keeps this anchor out of the Tab order —
 * per docs/search-architecture.md §8/§9, this list uses `aria-
 * activedescendant` on the owning input (see search-results.tsx), not
 * per-item focus; Tab inside the dialog should reach only the input itself
 * (and any dialog-level controls), never cycle through every result row.
 * The anchor is still reachable by mouse click, and `use-global-search.ts`
 * simulates a click on it (via `ref`) to fire Enter-triggered navigation
 * through this exact same, single code path.
 *
 * `url` is always the backend's own already-allowlisted `result-links.ts`
 * output (see src/lib/search/types.ts) — this component never constructs
 * or mutates it.
 *
 * Global Search Slice B — `id` is now an explicit, caller-supplied prop
 * (was: internally derived from a `FlatSearchResult.flatIndex` this
 * component no longer needs) so the exact same row renderer serves both a
 * live result (its own `global-search-option-{flatIndex}` id, unchanged)
 * and a Recent result (a distinctly-prefixed `global-search-recent-
 * option-{index}` id — see search-results.tsx) without ever risking an
 * accidental id collision between the two, even though the two are never
 * actually rendered at the same time. `onSelect` now reports which
 * `SearchResult` was chosen (was: a bare notification) so the one shared
 * selection handler (search-dialog.tsx) can record it as a Recent result
 * regardless of whether the click came from a live result or an existing
 * Recent row being re-selected.
 */
export function SearchResultItem({
  id,
  result,
  query,
  isActive,
  onHover,
  onSelect,
  ref,
}: {
  id: string;
  result: SearchResult;
  query: string;
  isActive: boolean;
  onHover: () => void;
  onSelect: (result: SearchResult) => void;
  ref?: Ref<HTMLAnchorElement>;
}) {
  return (
    <li id={id} role="option" aria-selected={isActive}>
      <Link
        ref={ref}
        href={result.url}
        tabIndex={-1}
        prefetch={false}
        onMouseEnter={onHover}
        onClick={() => onSelect(result)}
        className={`block rounded-md px-3 py-2 transition-colors ${
          isActive ? "bg-accent-subtle" : "hover:bg-[var(--hover)]"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-text-primary min-w-0 truncate text-sm font-medium">
            <SearchHighlight text={result.title} query={query} />
          </p>
          <span className="text-text-muted shrink-0 text-xs font-medium">{TYPE_LABEL[result.type]}</span>
        </div>
        {result.subtitle && <p className="text-text-muted truncate text-xs">{result.subtitle}</p>}
        {result.preview && (
          <p className="text-text-secondary mt-0.5 line-clamp-2 text-xs">
            <SearchHighlight text={result.preview} query={query} />
          </p>
        )}
      </Link>
    </li>
  );
}
