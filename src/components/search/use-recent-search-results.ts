"use client";

import { useState } from "react";
import {
  readRecentSearchResults,
  addRecentSearchResult,
  clearRecentSearchResults,
  type RecentSearchResult,
} from "@/lib/search-ui/recent-searches";

/**
 * Global Search Slice B. A small, dedicated UI-state wrapper around the
 * pure storage module -- kept out of useGlobalSearch.ts on purpose (that
 * hook's own job is the live request lifecycle only; see its header
 * comment) and out of SearchDialog's own body (keeps that component
 * focused on dialog/keyboard orchestration, not persistence).
 *
 * `organizationId`/`userId` are `null` whenever the caller doesn't (yet)
 * have a resolvable staff identity/org -- recents are then always empty
 * and every operation here is a safe no-op, never a fallback to an
 * unscoped key (Slice B spec §12).
 */
export function useRecentSearchResults(organizationId: string | null, userId: string | null) {
  const [recents, setRecents] = useState<RecentSearchResult[]>([]);

  /**
   * Re-reads from storage and returns the fresh list synchronously (a
   * localStorage read is itself synchronous) -- called from the dialog's
   * own `open()` handler so recents are always current as of the moment
   * the dialog is actually opened, not merely whatever was read once at
   * mount time (Slice B spec §23).
   */
  function refresh(): RecentSearchResult[] {
    if (!organizationId || !userId) {
      setRecents([]);
      return [];
    }
    const fresh = readRecentSearchResults(organizationId, userId);
    setRecents(fresh);
    return fresh;
  }

  /** Records a selected live result, or moves an already-recent one back to the front -- the exact same operation either way (Slice B spec §29: one shared path). */
  function record(result: RecentSearchResult): void {
    if (!organizationId || !userId) return;
    setRecents(addRecentSearchResult(organizationId, userId, result));
  }

  function clear(): void {
    if (!organizationId || !userId) return;
    clearRecentSearchResults(organizationId, userId);
    setRecents([]);
  }

  return { recents, refresh, record, clear };
}
